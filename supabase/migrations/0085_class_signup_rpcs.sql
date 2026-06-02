-- 0085_class_signup_rpcs.sql
-- 학부모 공개 페이지(/s/<token>) 진입·신청 RPC 두 개 + 페이지 행사일시 컬럼.
-- 0084 의 새 테이블 위에 동작. 0082 의 RPC 구조를 그대로 가져와 테이블만 교체.
--
-- 추가:
--   ALTER crm_class_signup_pages ADD COLUMN held_at TIMESTAMPTZ
--     강좌(crm_classes) 는 반복 일정(schedule_days/time) 만 보유하므로 단발 행사인
--     설명회의 정확한 시각을 페이지 측에 별도 저장. 학부모 화면 노출 + 종료 여부 판정.
--
-- RPC:
--   lookup_signup_invitation_by_token(token text)
--     → invitation 1행 + items jsonb 배열(카드 N개 — 각 페이지의 강좌·시각·정원·상태).
--     → 학부모가 /s/<token> 들어왔을 때 호출. anon 허용 (SECURITY DEFINER 로 RLS 우회).
--   claim_signup_item(token text, signup_page_id uuid)
--     → 학부모 [신청] 클릭 1건 처리. 멱등·row-lock·정원·창 검증.
--     → 반환 status: signed / already_signed / closed / ended / cancelled / invalid / out_of_window.
--
-- 권한:
--   - REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO anon, authenticated
--   - SECURITY DEFINER + search_path 잠금
--   - 토큰(72bit) 보유 = 학부모 본인 가정 (0082 와 동일 신뢰 모델)
--
-- 의존성:
--   - 0084 (crm_class_signup_pages / _invitations / _items)
--   - crm_classes (페이지의 class_id FK)
--   - crm_students (invitation 의 student_id FK)
--
-- 롤백:
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.claim_signup_item(text, uuid);
--   DROP FUNCTION IF EXISTS public.lookup_signup_invitation_by_token(text);
--   ALTER TABLE public.crm_class_signup_pages DROP COLUMN IF EXISTS held_at;
--   COMMIT;

BEGIN;

SET LOCAL statement_timeout = '2min';

-- ════════════════════════════════════════════════════════════════
-- 1) crm_class_signup_pages.held_at — 단발 행사 시각
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.crm_class_signup_pages
  ADD COLUMN IF NOT EXISTS held_at TIMESTAMPTZ;

COMMENT ON COLUMN public.crm_class_signup_pages.held_at IS
  '설명회 실 진행 시각 (timestamptz, KST 기준 운영). 강좌(crm_classes)의 반복 schedule_days/time 으로는 단일 시각을 표현 못 해 페이지에 별도 보유. NULL 이면 미정 — 학부모 페이지에서 "일시 미정" 또는 강좌의 schedule_* 텍스트로 fallback. 종료 여부 판정에도 사용.';

-- ════════════════════════════════════════════════════════════════
-- 2) lookup_signup_invitation_by_token(text)
-- ════════════════════════════════════════════════════════════════
-- 학부모 공개 페이지(/s/<token>) 가 호출. anon. SECURITY DEFINER 로 RLS 우회.
-- 반환 1행 + items jsonb (status=cancelled 카드도 포함 — 화면에서 회색 처리).
CREATE OR REPLACE FUNCTION public.lookup_signup_invitation_by_token(p_token text)
RETURNS TABLE (
  invitation_id  uuid,
  student_id     uuid,
  student_name   text,
  parent_phone   text,
  branch         text,
  items          jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    inv.id                  AS invitation_id,
    inv.student_id          AS student_id,
    stu.name                AS student_name,
    stu.parent_phone        AS parent_phone,
    inv.branch              AS branch,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'item_id',        it.id,
            'signup_page_id', pg.id,
            'class_id',       cl.id,
            'name',           cl.name,
            'description',    pg.description,
            'held_at',        pg.held_at,
            'venue',          cl.classroom,
            'page_status',    pg.status,
            'item_status',    it.status,
            'signed_at',      it.signed_at,
            'signup_opens_at',  pg.signup_opens_at,
            'signup_closes_at', pg.signup_closes_at
          )
          ORDER BY pg.held_at NULLS LAST, cl.name
        )
        FROM public.crm_class_signup_items it
        JOIN public.crm_class_signup_pages pg ON pg.id = it.signup_page_id
        LEFT JOIN public.crm_classes cl ON cl.id = pg.class_id
        WHERE it.invitation_id = inv.id
      ),
      '[]'::jsonb
    ) AS items
  FROM public.crm_class_signup_invitations inv
  JOIN public.crm_students stu ON stu.id = inv.student_id
  WHERE inv.link_token = p_token
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.lookup_signup_invitation_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_signup_invitation_by_token(text) TO anon, authenticated;

COMMENT ON FUNCTION public.lookup_signup_invitation_by_token(text) IS
  '학부모 공개 페이지(/s/<token>) 진입 시 호출. 1행=학생 메타+items jsonb 배열. 존재하지 않으면 0행. 0084 새 테이블 기반 — 0082 의 lookup_invitation_by_token 대체. class_id NULL(B안)은 cl.* 가 NULL 로 채워져 학부모 화면에서 처리 필요.';

-- ════════════════════════════════════════════════════════════════
-- 3) claim_signup_item(text, uuid)
-- ════════════════════════════════════════════════════════════════
-- 학부모 [신청] 클릭. 트랜잭션·row-lock. 정원·창·취소 검증.
-- 반환 status:
--   'signed'         이번 클릭으로 pending → signed (정상 접수)
--   'already_signed' 이미 signed (멱등 — 재클릭 무해)
--   'closed'         페이지 마감(정원 도달 또는 운영자 closed)
--   'ended'          행사 시각 경과 (held_at < now)
--   'cancelled'      운영자가 이 카드 취소
--   'invalid'        토큰 또는 (token, signup_page) 매핑 오류
--   'out_of_window'  신청 창 밖
CREATE OR REPLACE FUNCTION public.claim_signup_item(
  p_token          text,
  p_signup_page_id uuid
)
RETURNS TABLE (
  status   text,
  item_id  uuid,
  reason   text
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv_id          uuid;
  v_page            public.crm_class_signup_pages%ROWTYPE;
  v_item            public.crm_class_signup_items%ROWTYPE;
  v_class_capacity  integer;
  v_effective_cap   integer;
  v_now             timestamptz := now();
  v_signed_count    integer;
BEGIN
  -- 0) 입력 sanity
  IF p_token IS NULL OR length(btrim(p_token)) = 0 THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, '유효하지 않은 링크입니다'::text;
    RETURN;
  END IF;
  IF p_signup_page_id IS NULL THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, '신청 페이지 정보가 누락되었습니다'::text;
    RETURN;
  END IF;

  -- 1) invitation lookup by token
  SELECT inv.id INTO v_inv_id
  FROM public.crm_class_signup_invitations inv
  WHERE inv.link_token = p_token
  LIMIT 1;

  IF v_inv_id IS NULL THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, '유효하지 않은 링크입니다'::text;
    RETURN;
  END IF;

  -- 2) item lookup by (invitation_id, signup_page_id) + row lock
  --    "이 학생에게 안 보낸 페이지" 거부.
  SELECT * INTO v_item
  FROM public.crm_class_signup_items it
  WHERE it.invitation_id  = v_inv_id
    AND it.signup_page_id = p_signup_page_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, '이 설명회는 신청 대상이 아닙니다'::text;
    RETURN;
  END IF;

  -- 3) 멱등: 이미 signed
  IF v_item.status = 'signed' THEN
    RETURN QUERY SELECT 'already_signed'::text, v_item.id, NULL::text;
    RETURN;
  END IF;

  -- 4) 운영자가 취소한 카드
  IF v_item.status = 'cancelled' THEN
    RETURN QUERY SELECT 'cancelled'::text, v_item.id, '취소된 신청입니다'::text;
    RETURN;
  END IF;

  -- 5) page 조회 + 정원 검증용 row lock
  SELECT * INTO v_page
  FROM public.crm_class_signup_pages pg
  WHERE pg.id = p_signup_page_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- FK + CASCADE 가 있으므로 사실상 발생 X. 방어.
    RETURN QUERY SELECT 'invalid'::text, v_item.id, '신청 페이지를 찾을 수 없습니다'::text;
    RETURN;
  END IF;

  -- 6) 페이지 상태별 조기 종료
  --    draft = 공개 안 됨 — 운영자가 토글 안 켰음. 학부모는 사실상 들어오면 안 되지만 방어.
  IF v_page.status = 'draft' THEN
    RETURN QUERY SELECT 'closed'::text, v_item.id, '아직 신청을 받지 않는 페이지입니다'::text;
    RETURN;
  END IF;
  IF v_page.status = 'closed' THEN
    RETURN QUERY SELECT 'closed'::text, v_item.id, '신청이 마감되었습니다'::text;
    RETURN;
  END IF;

  -- 7) 행사 시각 경과(ended) 판정 — held_at 가 있고 그 시각이 지난 경우.
  --    held_at NULL 이면 ended 판정 안 함 (운영자가 시각 미입력 시나리오).
  IF v_page.held_at IS NOT NULL AND v_now > v_page.held_at THEN
    RETURN QUERY SELECT 'ended'::text, v_item.id, '종료된 설명회입니다'::text;
    RETURN;
  END IF;

  -- 8) 신청 창 검증
  IF v_page.signup_opens_at IS NOT NULL AND v_now < v_page.signup_opens_at THEN
    RETURN QUERY SELECT 'out_of_window'::text, v_item.id, '신청 시작 전입니다'::text;
    RETURN;
  END IF;
  IF v_page.signup_closes_at IS NOT NULL AND v_now > v_page.signup_closes_at THEN
    RETURN QUERY SELECT 'out_of_window'::text, v_item.id, '신청이 마감되었습니다'::text;
    RETURN;
  END IF;

  -- 9) 정원 검증 — page.capacity_override 우선, 없으면 class.capacity, 둘 다 NULL 이면 무제한.
  IF v_page.capacity_override IS NOT NULL THEN
    v_effective_cap := v_page.capacity_override;
  ELSIF v_page.class_id IS NOT NULL THEN
    SELECT cl.capacity INTO v_class_capacity
    FROM public.crm_classes cl
    WHERE cl.id = v_page.class_id;
    v_effective_cap := v_class_capacity;
  ELSE
    v_effective_cap := NULL;
  END IF;

  IF v_effective_cap IS NOT NULL THEN
    SELECT COUNT(*)::int INTO v_signed_count
    FROM public.crm_class_signup_items it
    WHERE it.signup_page_id = p_signup_page_id
      AND it.status         = 'signed';

    IF v_signed_count >= v_effective_cap THEN
      -- 다른 학생이 먼저 채움. 페이지 status 도 closed 로 전이.
      IF v_page.status = 'open' THEN
        UPDATE public.crm_class_signup_pages pg2
           SET status = 'closed'
         WHERE pg2.id     = p_signup_page_id
           AND pg2.status = 'open';
      END IF;
      RETURN QUERY SELECT 'closed'::text, v_item.id, '정원이 마감되었습니다'::text;
      RETURN;
    END IF;
  END IF;

  -- 10) pending → signed
  UPDATE public.crm_class_signup_items it
     SET status    = 'signed',
         signed_at = v_now
   WHERE it.id = v_item.id;

  -- 11) 이번 신청으로 정원 도달이면 페이지 status='closed' 전이
  IF v_effective_cap IS NOT NULL THEN
    SELECT COUNT(*)::int INTO v_signed_count
    FROM public.crm_class_signup_items it
    WHERE it.signup_page_id = p_signup_page_id
      AND it.status         = 'signed';

    IF v_signed_count >= v_effective_cap AND v_page.status = 'open' THEN
      UPDATE public.crm_class_signup_pages pg2
         SET status = 'closed'
       WHERE pg2.id     = p_signup_page_id
         AND pg2.status = 'open';
    END IF;
  END IF;

  RETURN QUERY SELECT 'signed'::text, v_item.id, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_signup_item(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_signup_item(text, uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.claim_signup_item(text, uuid) IS
  '학부모 [신청] 클릭 1건 처리 (SECURITY DEFINER, row-lock). 정원은 page.capacity_override > class.capacity > 무제한 순. 반환 status: signed / already_signed / closed / ended / cancelled / invalid / out_of_window. 정원 도달 시 페이지 status=closed 자동 전이.';

COMMIT;
