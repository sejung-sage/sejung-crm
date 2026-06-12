-- 0091_signup_dedupe_by_student.sql
-- 설명회 중복 신청 방지 기준을 (invitation/링크) → (학생, 설명회=signup_page) 로.
--
-- 버그 (2026-06-12, 운영진 발견):
--   같은 학생에게 발송이 여러 번(테스트 발송 등) 나가면 invitation(=링크)이 여러 개
--   생기고 토큰이 다르다. 각 invitation 은 같은 signup_page 에 대한 item 을 따로 갖는다.
--   학생이 링크 A 로 신청(item_A=signed)해도, 링크 B 의 item_B 는 'pending' 이라
--   claim_signup_item 의 멱등 체크(같은 item)·limit_reached(같은 invitation)에 안 걸려
--   같은 설명회를 다시 신청할 수 있었다.
--
-- 수정:
--   (a) claim_signup_item — 학생 단위 가드 2종 추가.
--       · 같은 설명회를 이 학생이 다른 invitation 으로 이미 signed → 'already_signed'.
--         (page FOR UPDATE 락 이후라 동일 설명회 동시 claim 이 직렬화 → race-safe.)
--       · allow_multiple=false 가드도 invitation 내부 → 학생 전체(다른 링크 포함)로 확장.
--   (b) lookup_signup_invitation_by_token — 학부모 페이지 표시도 학생 단위로.
--       같은 설명회를 다른 링크로 이미 신청했으면 이 링크에서도 '신청 완료'로 보이게
--       (item_status/signed_at 를 학생의 signed sibling 기준으로 노출).
--
-- 시그니처 불변 → CREATE OR REPLACE. 0085/0087 본문 + 델타.
--
-- 롤백: 0087 의 두 함수 정의를 CREATE OR REPLACE 로 재실행.

BEGIN;

SET LOCAL statement_timeout = '2min';

-- ════════════════════════════════════════════════════════════════
-- (b) lookup_signup_invitation_by_token — 표시도 학생 단위
-- ════════════════════════════════════════════════════════════════
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
            -- 학생 단위 표시: 이 학생이 (다른 링크 포함) 이 설명회를 이미 signed 했으면
            -- 이 링크의 카드도 signed 로 노출. signed_at 도 그 signed 시각을 쓴다.
            'item_status',    COALESCE(sib.status, it.status),
            'signed_at',      COALESCE(sib.signed_at, it.signed_at),
            'signup_opens_at',  pg.signup_opens_at,
            'signup_closes_at', pg.signup_closes_at
          )
          ORDER BY pg.held_at NULLS LAST, cl.name
        )
        FROM public.crm_class_signup_items it
        JOIN public.crm_class_signup_pages pg ON pg.id = it.signup_page_id
        LEFT JOIN public.crm_classes cl ON cl.id = pg.class_id
        LEFT JOIN LATERAL (
          -- 이 학생이 같은 설명회를 어느 링크로든 signed 한 카드 1건.
          SELECT it3.status, it3.signed_at
          FROM public.crm_class_signup_items it3
          JOIN public.crm_class_signup_invitations inv3
            ON inv3.id = it3.invitation_id
          WHERE inv3.student_id    = inv.student_id
            AND it3.signup_page_id = it.signup_page_id
            AND it3.status         = 'signed'
          LIMIT 1
        ) sib ON true
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
  '학부모 공개 페이지(/s/<token>) 진입 시 호출. item_status/signed_at 는 학생 단위(같은 설명회를 다른 링크로 신청했으면 signed 로 표시). 0091.';

-- ════════════════════════════════════════════════════════════════
-- (a) claim_signup_item — 학생 단위 중복 방지
-- ════════════════════════════════════════════════════════════════
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
  v_student_id      uuid;
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
  SELECT inv.id, inv.allow_multiple, inv.student_id
    INTO v_inv_id, v_allow_multiple, v_student_id
  FROM public.crm_class_signup_invitations inv
  WHERE inv.link_token = p_token
  LIMIT 1;

  IF v_inv_id IS NULL THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, '유효하지 않은 링크입니다'::text;
    RETURN;
  END IF;

  -- 2) item lookup by (invitation_id, signup_page_id) + row lock
  SELECT * INTO v_item
  FROM public.crm_class_signup_items it
  WHERE it.invitation_id  = v_inv_id
    AND it.signup_page_id = p_signup_page_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, '이 설명회는 신청 대상이 아닙니다'::text;
    RETURN;
  END IF;

  -- 3) 멱등: 이 카드가 이미 signed
  IF v_item.status = 'signed' THEN
    RETURN QUERY SELECT 'already_signed'::text, v_item.id, NULL::text;
    RETURN;
  END IF;

  -- 4) 운영자가 취소한 카드
  IF v_item.status = 'cancelled' THEN
    RETURN QUERY SELECT 'cancelled'::text, v_item.id, '취소된 신청입니다'::text;
    RETURN;
  END IF;

  -- 4-2) 중복 신청 불가(allow_multiple=false): 이 학생이 (다른 링크 포함) 다른
  --      설명회를 이미 signed 했으면 차단. (0091: invitation 내부 → 학생 전체로 확장.)
  IF NOT v_allow_multiple THEN
    PERFORM 1
      FROM public.crm_class_signup_items it2
      JOIN public.crm_class_signup_invitations inv2 ON inv2.id = it2.invitation_id
      WHERE inv2.student_id    = v_student_id
        AND it2.signup_page_id <> p_signup_page_id
        AND it2.status = 'signed'
      LIMIT 1;
    IF FOUND THEN
      RETURN QUERY SELECT 'limit_reached'::text, v_item.id,
        '1개만 신청할 수 있어요. 이미 다른 설명회를 신청했습니다.'::text;
      RETURN;
    END IF;
  END IF;

  -- 5) page 조회 + 정원 검증용 row lock (동일 설명회 동시 claim 직렬화 지점)
  SELECT * INTO v_page
  FROM public.crm_class_signup_pages pg
  WHERE pg.id = p_signup_page_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, v_item.id, '신청 페이지를 찾을 수 없습니다'::text;
    RETURN;
  END IF;

  -- 5-2) ★학생 단위 중복 방지(핵심)★ 이 학생이 다른 링크(invitation)로 이 설명회를
  --      이미 signed 했으면 already_signed. 위 page FOR UPDATE 로 동일 설명회 동시
  --      claim 이 직렬화돼 race-safe. (테스트/재발송으로 링크가 여러 개여도 학생당 1회.)
  PERFORM 1
    FROM public.crm_class_signup_items it2
    JOIN public.crm_class_signup_invitations inv2 ON inv2.id = it2.invitation_id
    WHERE inv2.student_id    = v_student_id
      AND it2.signup_page_id = p_signup_page_id
      AND it2.status = 'signed'
    LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT 'already_signed'::text, v_item.id, NULL::text;
    RETURN;
  END IF;

  -- 6) 페이지 상태별 조기 종료
  IF v_page.status = 'draft' THEN
    RETURN QUERY SELECT 'closed'::text, v_item.id, '아직 신청을 받지 않는 페이지입니다'::text;
    RETURN;
  END IF;
  IF v_page.status = 'closed' THEN
    RETURN QUERY SELECT 'closed'::text, v_item.id, '신청이 마감되었습니다'::text;
    RETURN;
  END IF;

  -- 7) 행사 시각 경과(ended)
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

  -- 9) 정원 검증
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
  '학부모 [신청] 클릭 1건 처리 (SECURITY DEFINER, row-lock). 중복 방지는 (학생, 설명회=signup_page) 기준 — 다른 링크(invitation)로 이미 signed 면 already_signed. allow_multiple=false 는 학생 전체 다른 설명회 signed 시 limit_reached. 0091.';

COMMIT;
