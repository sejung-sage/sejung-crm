-- ============================================================
-- 0063_student_profiles_drop_attendance_rate.sql
-- 출석률(%) 개념 전체 제거 + absent_count 산식 정정.
-- ------------------------------------------------------------
-- 운영 결정 (2026-05-20):
--   "출석률"(%) 지표 자체를 운영에서 사용하지 않기로 함.
--   ETL 매핑 갭(0061→0062 fix 반복), 분원별 정책 차이, 운영자별 해석 차이로
--   숫자가 신뢰를 잃어 의사결정에 활용 안 됨. 결석 수·출석 격자·강좌별 출/결
--   raw 카운트는 그대로 유지 — 그 정보만으로도 운영 시야 충분.
--
-- 변경:
--   1) student_profiles.attendance_rate 컬럼 제거.
--   2) absent_count 산식을 attendance_rate (0062) 와 동일 매칭으로 좁힘:
--      a.aca_class_id IN (해당 학생의 enrollments.aca_class_id) 인 row 의
--      status='결석' 만 카운트. 등록 외 강좌 attendance 잔재가 KPI 를
--      부풀리던 회귀 차단 (현장 사례: 박준희 — 격자에는 결석 0인데 카드는 2).
--
-- ROLLBACK:
--   0062 의 CREATE VIEW 블록 재실행.
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
  -- absent_count — enrollment 매칭 attendance row 만 카운트.
  -- 격자에 보이는 출결과 1:1 일관. 등록 외 강좌 결석 잔재가 카드 부풀리던 회귀 차단.
  (
    SELECT COUNT(*)
    FROM public.crm_attendances a2
    WHERE a2.student_id = s.id
      AND a2.status = '결석'
      AND a2.aca_class_id IS NOT NULL
      AND a2.aca_class_id IN (
        SELECT e3.aca_class_id
        FROM public.crm_enrollments e3
        WHERE e3.student_id = s.id
          AND e3.aca_class_id IS NOT NULL
      )
  ) AS absent_count,
  MAX(a.attended_at) AS last_attended_at,
  MAX(e.paid_at) AS last_paid_at,
  COALESCE(sr.region, '기타') AS region
FROM public.crm_students s
LEFT JOIN public.crm_enrollments e    ON e.student_id = s.id
LEFT JOIN public.crm_attendances a    ON a.student_id = s.id
LEFT JOIN public.crm_school_regions sr ON sr.school = s.school
GROUP BY s.id, sr.region;

COMMENT ON VIEW public.student_profiles IS
  '학생 프로필 (crm_* curated layer). 0063 — attendance_rate(%) 컬럼 제거. absent_count 가 enrollment 매칭 attendance row 만 카운트 (격자와 1:1 일관).';
COMMENT ON COLUMN public.student_profiles.absent_count IS
  '결석 횟수 — 학생의 enrollments 와 매칭되는 attendance row 의 status=결석 카운트. UI 격자에 보이는 결석과 정확히 일치.';

COMMIT;
