-- 0053_rename_status_no_enrollment.sql
-- 재원 상태 '수강이력없음' → '수강 x' 로 이름 변경 (사용자 요청).
--
-- 순서: CHECK DROP → UPDATE 데이터 → CHECK ADD (새 4종) → apply_aca_to_crm() 갱신.

BEGIN;

SET LOCAL statement_timeout = '5min';

-- ── 1) CHECK 풀기 (UPDATE 가능하게) ─────────────────────
ALTER TABLE public.aca_students
  DROP CONSTRAINT IF EXISTS students_status_check;
ALTER TABLE public.crm_students
  DROP CONSTRAINT IF EXISTS students_status_check;

-- ── 2) 기존 데이터 rename ───────────────────────────────
UPDATE public.aca_students SET status = '수강 x' WHERE status = '수강이력없음';
UPDATE public.crm_students SET status = '수강 x' WHERE status = '수강이력없음';

-- ── 3) 새 CHECK 추가 (4종, '수강 x' 포함) ──────────────
ALTER TABLE public.aca_students
  ADD CONSTRAINT students_status_check
  CHECK (status IN ('재원생', '수강이력자', '수강 x', '탈퇴'));
ALTER TABLE public.crm_students
  ADD CONSTRAINT students_status_check
  CHECK (status IN ('재원생', '수강이력자', '수강 x', '탈퇴'));

-- ── 4) apply_aca_to_crm() — 새 이름 적용 ────────────────
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
  WITH active_set AS (
    SELECT DISTINCT student_id
    FROM public.aca_enrollments
    WHERE end_date IS NULL OR end_date >= CURRENT_DATE
  ),
  any_enrollment_set AS (
    SELECT DISTINCT student_id FROM public.aca_enrollments
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
        WHEN a.id IN (SELECT student_id FROM any_enrollment_set) THEN '수강이력자'
        ELSE '수강 x'
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
  '0053 — status 4종 (재원생/수강이력자/수강 x/탈퇴).';

COMMIT;
