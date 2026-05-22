-- ============================================================
-- 0072_apply_aca_to_crm_timeout.sql
-- apply_aca_to_crm() 의 statement_timeout 을 함수 단에서 늘림.
-- ------------------------------------------------------------
-- 배경:
--   Supabase Postgres 의 default statement_timeout 은 인증 사용자 8s.
--   apply_aca_to_crm() 는 aca_* (6만 학생 + 38만 ticket 등) 의 전체
--   정제·UPSERT 를 한 트랜잭션으로 처리하므로 8s 안에 끝나지 않음.
--
--   ETL wrapper 의 마지막 step `apply_to_crm` 가 호출할 때마다 다음 에러:
--     code: 57014 — "canceling statement due to statement timeout"
--
-- 수정:
--   함수 본문 첫 줄에 `SET LOCAL statement_timeout = '20min'` 추가.
--   본 함수가 호출된 트랜잭션에 한정 적용. 다른 일반 쿼리는 8s 유지.
--
-- 본문 변경 없음 — 0051 의 함수를 그대로 CREATE OR REPLACE, SET LOCAL 만 첫 줄에 추가.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.apply_aca_to_crm()
RETURNS TABLE(
  students_upserted bigint,
  classes_upserted bigint,
  enrollments_upserted bigint,
  attendances_upserted bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_students bigint;
  v_classes bigint;
  v_enrollments bigint;
  v_attendances bigint;
BEGIN
  -- 6만 학생 + 38만 ticket 등 대용량 UPSERT 가 default 8s 초과 → 20분.
  -- 본 함수 호출 트랜잭션에 한정. 일반 쿼리는 8s 유지.
  SET LOCAL statement_timeout = '20min';

  -- ── crm_students 갱신 (정제 룰 적용) ──
  WITH active_set AS (
    SELECT DISTINCT student_id
    FROM public.aca_enrollments
    WHERE end_date IS NULL OR end_date >= CURRENT_DATE
  ),
  school_candidate AS (
    SELECT
      e.student_id,
      ks.school,
      COUNT(*) AS hits
    FROM public.aca_enrollments e
    JOIN public.aca_classes c ON c.aca_class_id = e.aca_class_id
    JOIN public.crm_school_regions ks ON c.name LIKE '%' || ks.school || '%'
    WHERE LENGTH(ks.school) >= 2
    GROUP BY e.student_id, ks.school
  ),
  best_school AS (
    SELECT DISTINCT ON (student_id)
      student_id, school
    FROM school_candidate
    ORDER BY student_id, hits DESC, LENGTH(school) DESC
  ),
  src AS (
    SELECT
      a.id, a.aca2000_id, a.name, a.phone, a.parent_phone,
      COALESCE(a.school, bs.school) AS school,
      a.grade, a.grade_raw, a.school_level,
      CASE
        WHEN a.status = '탈퇴' THEN '탈퇴'
        WHEN a.id IN (SELECT student_id FROM active_set) THEN '재원생'
        ELSE '수강이력자'
      END AS status,
      a.branch, a.registered_at,
      a.created_at, a.updated_at
    FROM public.aca_students a
    LEFT JOIN best_school bs ON bs.student_id = a.id
  ),
  ups AS (
    INSERT INTO public.crm_students (
      id, aca2000_id, name, phone, parent_phone, school,
      grade, grade_raw, school_level, status, branch, registered_at,
      created_at, updated_at
    )
    SELECT
      id, aca2000_id, name, phone, parent_phone, school,
      grade, grade_raw, school_level, status, branch, registered_at,
      created_at, updated_at
    FROM src
    ON CONFLICT (id) DO UPDATE SET
      aca2000_id   = EXCLUDED.aca2000_id,
      name         = EXCLUDED.name,
      phone        = EXCLUDED.phone,
      parent_phone = EXCLUDED.parent_phone,
      school       = EXCLUDED.school,
      grade        = EXCLUDED.grade,
      grade_raw    = EXCLUDED.grade_raw,
      school_level = EXCLUDED.school_level,
      status       = EXCLUDED.status,
      branch       = EXCLUDED.branch,
      registered_at= EXCLUDED.registered_at,
      updated_at   = now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_students FROM ups;

  -- ── crm_classes 갱신 (1:1) ──
  WITH ups AS (
    INSERT INTO public.crm_classes
      SELECT * FROM public.aca_classes
    ON CONFLICT (id) DO UPDATE SET
      aca_class_id       = EXCLUDED.aca_class_id,
      branch             = EXCLUDED.branch,
      name               = EXCLUDED.name,
      teacher_name       = EXCLUDED.teacher_name,
      subject_raw        = EXCLUDED.subject_raw,
      subject            = EXCLUDED.subject,
      total_sessions     = EXCLUDED.total_sessions,
      amount_per_session = EXCLUDED.amount_per_session,
      total_amount       = EXCLUDED.total_amount,
      capacity           = EXCLUDED.capacity,
      schedule_days      = EXCLUDED.schedule_days,
      schedule_time      = EXCLUDED.schedule_time,
      start_date         = EXCLUDED.start_date,
      end_date           = EXCLUDED.end_date,
      active             = EXCLUDED.active,
      updated_at         = now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_classes FROM ups;

  -- ── crm_enrollments 갱신 (1:1) ──
  WITH ups AS (
    INSERT INTO public.crm_enrollments
      SELECT * FROM public.aca_enrollments
    ON CONFLICT (id) DO UPDATE SET
      student_id    = EXCLUDED.student_id,
      course_name   = EXCLUDED.course_name,
      teacher_name  = EXCLUDED.teacher_name,
      subject       = EXCLUDED.subject,
      amount        = EXCLUDED.amount,
      paid_at       = EXCLUDED.paid_at,
      start_date    = EXCLUDED.start_date,
      end_date      = EXCLUDED.end_date,
      aca_class_id  = EXCLUDED.aca_class_id,
      updated_at    = now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_enrollments FROM ups;

  -- ── crm_attendances 갱신 (1:1) ──
  WITH ups AS (
    INSERT INTO public.crm_attendances
      SELECT * FROM public.aca_attendances
    ON CONFLICT (id) DO UPDATE SET
      student_id    = EXCLUDED.student_id,
      enrollment_id = EXCLUDED.enrollment_id,
      attended_at   = EXCLUDED.attended_at,
      status        = EXCLUDED.status
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_attendances FROM ups;

  RETURN QUERY SELECT v_students, v_classes, v_enrollments, v_attendances;
END;
$$;

COMMENT ON FUNCTION public.apply_aca_to_crm() IS
  'ETL 직후 호출 — aca_*(raw) → crm_*(curated) 일괄 정제 UPSERT. '
  'status/school 자동 룰 + 나머지 1:1. 0072 에서 SET LOCAL statement_timeout '
  '= 20min 추가 — 6만 학생 + 38만 ticket 규모에서 default 8s 초과 회귀 fix.';

COMMIT;
