-- ============================================================
-- 0081_signup_for_seminar_qualify_status.sql
-- 설명회 신청 RPC `signup_for_seminar` 의 ambiguous "status" 픽스.
-- ============================================================
--
-- 증상:
--   학부모 신청 제출 시 RPC 가 ERROR: column reference "status" is ambiguous
--   반환 → 앱은 "신청 처리에 실패했습니다: column reference 'status' is ambiguous"
--   안내 표시. INSERT 자체가 안 됨.
--
-- 원인:
--   RETURNS TABLE(status text, signup_id uuid, reason text) 의 OUT 파라미터
--   `status` 가 함수 본문 안에서 로컬 식별자로 잡힘. 본문의 SELECT/UPDATE
--   에 사용된 bare `status` 가 테이블 컬럼 `crm_seminar_signups.status` /
--   `crm_seminars.status` 와 충돌해 PostgreSQL 이 ambiguous 로 거부.
--
-- 수정:
--   본문의 모든 테이블 컬럼 참조에 별칭(또는 테이블명) 명시. 반환 시그니처는
--   불변(callers 가 `result.status` 로 읽고 있어 호환 유지). 함수 로직·동작은
--   완전히 동일. 0080 의 정의를 그대로 가져와 qualify 만 추가.
--
-- 적용:
--   CREATE OR REPLACE FUNCTION — 시그니처 동일하므로 GRANT 유지됨.

BEGIN;

CREATE OR REPLACE FUNCTION public.signup_for_seminar(
  p_token        text,
  p_student_name text,
  p_parent_phone text,
  p_client_ip    text DEFAULT NULL,
  p_user_agent   text DEFAULT NULL
)
RETURNS TABLE (
  status    text,
  signup_id uuid,
  reason    text
)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seminar          public.crm_seminars%ROWTYPE;
  v_normalized_phone text;
  v_clean_name       text;
  v_now              timestamptz := now();
  v_existing_id      uuid;
  v_signed_count     integer;
  v_new_id           uuid;
BEGIN
  -- 입력 정규화.
  v_clean_name := btrim(COALESCE(p_student_name, ''));
  v_normalized_phone := regexp_replace(COALESCE(p_parent_phone, ''), '[^0-9]', '', 'g');

  IF v_clean_name = '' OR length(v_clean_name) > 40 THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, '학생 이름이 유효하지 않습니다'::text;
    RETURN;
  END IF;
  IF length(v_normalized_phone) < 8 OR length(v_normalized_phone) > 11 THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, '학부모 연락처가 유효하지 않습니다'::text;
    RETURN;
  END IF;

  -- 설명회 조회 + row lock.
  SELECT * INTO v_seminar
  FROM public.crm_seminars s
  WHERE s.link_token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid, '유효하지 않은 링크입니다'::text;
    RETURN;
  END IF;

  -- 상태별 조기 종료. (v_seminar 는 ROWTYPE 변수 → 모호성 없음)
  IF v_seminar.status = 'cancelled' THEN
    RETURN QUERY SELECT 'cancelled'::text, NULL::uuid, '취소된 설명회입니다'::text;
    RETURN;
  END IF;

  IF v_seminar.status = 'ended' THEN
    RETURN QUERY SELECT 'ended'::text, NULL::uuid, '종료된 설명회입니다'::text;
    RETURN;
  END IF;

  -- 신청 창 검증.
  IF v_seminar.signup_opens_at IS NOT NULL AND v_now < v_seminar.signup_opens_at THEN
    RETURN QUERY SELECT 'out_of_window'::text, NULL::uuid, '신청 시작 전입니다'::text;
    RETURN;
  END IF;
  IF v_seminar.signup_closes_at IS NOT NULL AND v_now > v_seminar.signup_closes_at THEN
    RETURN QUERY SELECT 'out_of_window'::text, NULL::uuid, '신청이 마감되었습니다'::text;
    RETURN;
  END IF;

  IF v_seminar.status = 'closed' THEN
    RETURN QUERY SELECT 'closed'::text, NULL::uuid, '정원이 마감되었습니다'::text;
    RETURN;
  END IF;

  -- 중복(활성 신청) 검증 — 컬럼 모두 ss. 별칭으로 qualify.
  SELECT ss.id INTO v_existing_id
  FROM public.crm_seminar_signups ss
  WHERE ss.seminar_id   = v_seminar.id
    AND ss.parent_phone = v_normalized_phone
    AND ss.student_name = v_clean_name
    AND ss.status       = 'signed'
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN QUERY SELECT 'duplicate'::text, v_existing_id, '이미 신청된 학생입니다'::text;
    RETURN;
  END IF;

  -- INSERT.
  INSERT INTO public.crm_seminar_signups (
    seminar_id, student_name, parent_phone,
    status, client_ip, user_agent, created_at
  ) VALUES (
    v_seminar.id, v_clean_name, v_normalized_phone,
    'signed', p_client_ip, p_user_agent, v_now
  )
  RETURNING id INTO v_new_id;

  -- 정원 도달 시 자동 'closed' 전이 — 컬럼 qualify.
  IF v_seminar.capacity IS NOT NULL THEN
    SELECT COUNT(*)::int INTO v_signed_count
    FROM public.crm_seminar_signups ss
    WHERE ss.seminar_id = v_seminar.id
      AND ss.status     = 'signed';

    IF v_signed_count >= v_seminar.capacity THEN
      UPDATE public.crm_seminars sm
         SET status = 'closed'
       WHERE sm.id     = v_seminar.id
         AND sm.status = 'open';
    END IF;
  END IF;

  RETURN QUERY SELECT 'signed'::text, v_new_id, NULL::text;
END;
$$;

COMMENT ON FUNCTION public.signup_for_seminar(text, text, text, text, text) IS
  '학부모 설명회 신청 1건 INSERT. anon 권한. 정원/창/중복 검증을 함수 내부에서. '
  '0081 — RETURNS TABLE OUT 파라미터 status 와 충돌하던 본문 bare status '
  '참조를 모두 테이블 별칭(ss / sm)으로 qualify. 시그니처 동일, GRANT 유지.';

-- GRANT 는 0080 에서 부여된 상태 그대로 — CREATE OR REPLACE 는 GRANT 보존.

COMMIT;
