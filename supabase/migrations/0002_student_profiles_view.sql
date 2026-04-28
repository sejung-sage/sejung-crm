-- ============================================================
-- 0002_student_profiles_view.sql
-- student_profiles · 학생 프로필 집계 뷰
-- PRD 섹션 4.2 기준
-- ============================================================

CREATE OR REPLACE VIEW public.student_profiles AS
SELECT
  s.id,
  s.name,
  s.school,
  s.grade,
  s.track,
  s.status,
  s.branch,
  s.parent_phone,
  s.phone,
  s.registered_at,
  COUNT(DISTINCT e.id) AS enrollment_count,
  COALESCE(SUM(e.amount), 0)::BIGINT AS total_paid,
  ARRAY_AGG(DISTINCT e.subject)
    FILTER (WHERE e.subject IS NOT NULL) AS subjects,
  ARRAY_AGG(DISTINCT e.teacher_name)
    FILTER (WHERE e.teacher_name IS NOT NULL) AS teachers,
  ROUND(
    AVG(
      CASE WHEN a.status IN ('출석', '지각') THEN 1.0 ELSE 0.0 END
    ) * 100, 1
  ) AS attendance_rate,
  MAX(a.attended_at) AS last_attended_at,
  MAX(e.paid_at) AS last_paid_at
FROM public.students s
LEFT JOIN public.enrollments e ON e.student_id = s.id
LEFT JOIN public.attendances a ON a.student_id = s.id
GROUP BY s.id;

COMMENT ON VIEW public.student_profiles IS '학생 프로필 (students + enrollments + attendances 집계)';

-- 뷰 컬럼 주석은 기반 컬럼의 주석을 상속하지 않으므로 집계 컬럼만 명시적으로 추가
COMMENT ON COLUMN public.student_profiles.enrollment_count IS '총 수강 횟수';
COMMENT ON COLUMN public.student_profiles.total_paid IS '총 결제 금액 (원 단위)';
COMMENT ON COLUMN public.student_profiles.subjects IS '수강 과목 목록';
COMMENT ON COLUMN public.student_profiles.teachers IS '수강한 강사 목록';
COMMENT ON COLUMN public.student_profiles.attendance_rate IS '출석률 (출석+지각 / 전체 × 100, 소수 1자리)';
COMMENT ON COLUMN public.student_profiles.last_attended_at IS '마지막 출석일';
COMMENT ON COLUMN public.student_profiles.last_paid_at IS '마지막 결제일';
