-- ============================================================
-- 0066_student_profiles_drop_absent_count.sql
-- 결석 개념 제거 — student_profiles.absent_count 컬럼 삭제.
-- ------------------------------------------------------------
-- 운영 결정 (2026-05-20):
--   학원 운영상 결석이 발생하면 환불 처리 → 결석 row 자체가 거의 없거나
--   의미가 다름 (출결 이력보다 환불 정산이 본질). "결석" 이라는 분류 자체를
--   UI 와 KPI 에서 모두 제거하기로 함.
--
--   격자에 남은 attendance row 중 status='결석' 인 것은 비-방배에서 effective
--   "출석" 으로 매핑되어 chip 표시되며, 카운트는 어디에도 노출하지 않는다.
--
-- 변경:
--   - student_profiles.absent_count 컬럼 제거.
--   - 그 외 컬럼·산식 (active_enrollment_count, enrollment_count, total_paid
--     등) 은 0065 그대로.
--
-- ROLLBACK:
--   0065 의 CREATE VIEW 블록 재실행.
-- ============================================================

BEGIN;

SET LOCAL statement_timeout = '5min';

DROP VIEW IF EXISTS public.student_profiles;

CREATE VIEW public.student_profiles AS
SELECT
  s.id,
  s.name,
  s.school,
  s.grade,
  s.grade_raw,
  s.school_level,
  s.status,
  s.branch,
  s.parent_phone,
  s.phone,
  s.registered_at,
  COUNT(DISTINCT e.id) AS enrollment_count,
  (
    SELECT COUNT(*)
    FROM public.crm_enrollments e2
    LEFT JOIN public.crm_classes c2 ON c2.aca_class_id = e2.aca_class_id
    WHERE e2.student_id = s.id
      AND (e2.end_date IS NULL OR e2.end_date >= CURRENT_DATE)
      AND (c2.subject IS DISTINCT FROM '설명회')
  ) AS active_enrollment_count,
  COALESCE(SUM(e.amount), 0)::BIGINT AS total_paid,
  ARRAY_AGG(DISTINCT e.subject)
    FILTER (WHERE e.subject IS NOT NULL) AS subjects,
  ARRAY_AGG(DISTINCT e.teacher_name)
    FILTER (WHERE e.teacher_name IS NOT NULL) AS teachers,
  MAX(a.attended_at) AS last_attended_at,
  MAX(e.paid_at) AS last_paid_at,
  COALESCE(sr.region, '기타') AS region
FROM public.crm_students s
LEFT JOIN public.crm_enrollments e    ON e.student_id = s.id
LEFT JOIN public.crm_attendances a    ON a.student_id = s.id
LEFT JOIN public.crm_school_regions sr ON sr.school = s.school
GROUP BY s.id, sr.region;

COMMENT ON VIEW public.student_profiles IS
  '학생 프로필 (crm_* curated layer). 0066 — 결석 개념 제거 (absent_count 삭제). 출석률(%) 은 0065 에서 이미 제거.';

COMMIT;
