-- 0087_signup_allow_multiple.sql
-- 설명회 신청에 "중복 신청 허용/불가" 플래그 추가.
-- invitation 1건에 여러 카드(crm_class_signup_items = 설명회 회차)가 매달리는데,
-- 운영자가 발송 시 "이 학생은 1개만 신청 가능"으로 제한할 수 있게 한다.
--
-- 배경 (2026-06):
--   - 현행: 학부모는 카드별로 자유롭게 여러 개 신청 가능(allow_multiple 기본 true).
--   - 신규: 발송 위저드의 "중복 신청 허용" 체크 해제 시 invitation.allow_multiple=false.
--     → 이미 1개라도 signed 면 같은 invitation 의 나머지 카드 신청을 RPC 가 차단.
--
-- 변경:
--   (a) crm_class_signup_invitations.allow_multiple BOOLEAN NOT NULL DEFAULT true
--   (b) claim_signup_item(text, uuid)            — 단일선택 가드 추가(0085 본문 + 델타)
--   (c) lookup_signup_invitation_by_token(text)  — 반환에 allow_multiple 추가(0085 본문 + 델타)
--
-- 의존성:
--   - 0084 (crm_class_signup_invitations / _pages / _items)
--   - 0085 (claim_signup_item / lookup_signup_invitation_by_token 원본)
--
-- 새 claim status:
--   'limit_reached'  allow_multiple=false 인데 같은 invitation 의 다른 카드를 이미 signed.
--
-- 롤백:
--   BEGIN;
--   -- (b)/(c) 는 0085 의 원본 정의로 CREATE OR REPLACE 재실행해 되돌린다.
--   ALTER TABLE public.crm_class_signup_invitations DROP COLUMN IF EXISTS allow_multiple;
--   COMMIT;

BEGIN;

SET LOCAL statement_timeout = '2min';

-- ════════════════════════════════════════════════════════════════
-- (a) crm_class_signup_invitations.allow_multiple
-- ════════════════════════════════════════════════════════════════
ALTER TABLE public.crm_class_signup_invitations
  ADD COLUMN IF NOT EXISTS allow_multiple BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.crm_class_signup_invitations.allow_multiple IS
  '이 학생이 invitation 내 여러 설명회 카드를 중복 신청할 수 있는지. true(기본)=여러 개 신청 가능(현행), false=1개만 신청 가능 — 이미 1개라도 signed 면 나머지 카드 신청 차단. 발송 위저드의 "중복 신청 허용" 체크박스로 발송 시 설정.';

-- ════════════════════════════════════════════════════════════════
-- (c) lookup_signup_invitation_by_token(text)
--     0085 본문 그대로 + 반환에 allow_multiple 추가.
--     ⚠️ RETURNS TABLE 시그니처(반환 컬럼)가 바뀌므로 CREATE OR REPLACE 불가
--        (42P13: cannot change return type). DROP 후 재생성한다. anon/authenticated
--        GRANT 도 함께 사라지므로 아래에서 재부여한다.
-- ════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.lookup_signup_invitation_by_token(text);

CREATE OR REPLACE FUNCTION public.lookup_signup_invitation_by_token(p_token text)
RETURNS TABLE (
  invitation_id  uuid,
  student_id     uuid,
  student_name   text,
  parent_phone   text,
  branch         text,
  allow_multiple boolean,
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
    inv.allow_multiple      AS allow_multiple,
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
  '학부모 공개 페이지(/s/<token>) 진입 시 호출. 1행=학생 메타+allow_multiple+items jsonb 배열. 존재하지 않으면 0행. 0084 새 테이블 기반. allow_multiple(0087)=false 면 학부모 화면에서 "1개만 신청 가능" 안내 + 1개 signed 후 나머지 카드 비활성. class_id NULL(B안)은 cl.* 가 NULL 로 채워져 학부모 화면에서 처리 필요.';

-- ════════════════════════════════════════════════════════════════
-- (b) claim_signup_item(text, uuid)
--     0085 본문 그대로 + 단일선택 가드(4-2) 추가.
-- ════════════════════════════════════════════════════════════════
-- 반환 status:
--   'signed'         이번 클릭으로 pending → signed (정상 접수)
--   'already_signed' 이미 signed (멱등 — 재클릭 무해)
--   'limit_reached'  중복 신청 불가(allow_multiple=false) 인데 이미 다른 카드 signed (0087 신규)
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
  v_allow_multiple  boolean;
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
  SELECT inv.id, inv.allow_multiple
    INTO v_inv_id, v_allow_multiple
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

  -- 4-2) 중복 신청 불가(allow_multiple=false) 인데 이미 이 invitation 의 다른 카드를
  --      신청(signed)한 경우 차단. 자기 자신(v_item)은 아직 pending 이라 제외됨.
  IF NOT v_allow_multiple THEN
    PERFORM 1 FROM public.crm_class_signup_items it2
      WHERE it2.invitation_id = v_inv_id
        AND it2.status = 'signed'
      LIMIT 1;
    IF FOUND THEN
      RETURN QUERY SELECT 'limit_reached'::text, v_item.id,
        '1개만 신청할 수 있어요. 이미 다른 설명회를 신청했습니다.'::text;
      RETURN;
    END IF;
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
  '학부모 [신청] 클릭 1건 처리 (SECURITY DEFINER, row-lock). 정원은 page.capacity_override > class.capacity > 무제한 순. 반환 status: signed / already_signed / limit_reached / closed / ended / cancelled / invalid / out_of_window. limit_reached(0087)=invitation.allow_multiple=false 인데 이미 다른 카드 signed. 정원 도달 시 페이지 status=closed 자동 전이.';

COMMIT;
