-- ============================================================
-- 0056_student_profiles_attendance_rate_fix.sql
-- student_profiles VIEW 의 attendance_rate 산식 버그 수정.
-- ------------------------------------------------------------
-- 문제 (현장 사례 — 송지후, 대치):
--   강좌 3개 · 일자별 출결 총 12행 (출석 8, 결석 4) → 정확한 출석률 8/12 ≈ 66.7%.
--   그런데 KPI 카드/명단 정렬에서 0% 로 표시되는 회귀.
--
-- 원인:
--   0049/0051 마이그레이션이 뷰를 재정의하면서 비-방배 분원의 attendance_rate
--   산식을 잘못 작성:
--     GREATEST(
--       COUNT(DISTINCT e.id) - COUNT(DISTINCT a.id) FILTER (WHERE a.status='결석'),
--       0
--     ) / COUNT(DISTINCT e.id)
--
--   - 분자: enrollments 행 수 - 결석 attendances distinct 수 (단위 mismatch!)
--   - 분모: enrollments 행 수
--   송지후 사례: GREATEST(4 - 4, 0) / 4 = 0 → 0%.
--
-- 수정 — 0029 의 attendance row 기반 식으로 복원 (비-방배):
--   ROUND(
--     AVG(CASE WHEN a.status = '결석' THEN 0.0 ELSE 1.0 END)
--       FILTER (WHERE a.id IS NOT NULL) * 100,
--     1
--   )
--   - 분모: 학생의 전체 attendance row 수
--   - 분자: 결석을 제외한 row 수 (출석/지각/조퇴/보강 모두 출석 인정)
--   - 출결 데이터가 0행이면 NULL.
--   - 송지후: AVG([1,1,0,0, 1,1,1,0, 1,1,1,0]) = 8/12 → 66.7%.
--
-- 방배 분원은 0051 의 5종 분기 식을 그대로 유지 (변경 없음):
--   AVG(CASE WHEN status IN ('출석','지각','보강') THEN 1.0 ELSE 0.0 END)
--     FILTER (WHERE a.id IS NOT NULL)
--
-- 0051 의 dual-layer 적용 (crm_* 참조) 유지.
-- ROLLBACK: 본 마이그레이션 DROP VIEW + 0051 의 식 복구.
-- ============================================================

BEGIN;

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
  COALESCE(SUM(e.amount), 0)::BIGINT AS total_paid,
  ARRAY_AGG(DISTINCT e.subject)
    FILTER (WHERE e.subject IS NOT NULL) AS subjects,
  ARRAY_AGG(DISTINCT e.teacher_name)
    FILTER (WHERE e.teacher_name IS NOT NULL) AS teachers,
  CASE
    WHEN s.branch = '방배' THEN
      ROUND(
        AVG(
          CASE WHEN a.status IN ('출석', '지각', '보강') THEN 1.0 ELSE 0.0 END
        ) FILTER (WHERE a.id IS NOT NULL) * 100,
        1
      )
    ELSE
      ROUND(
        AVG(
          -- 비-방배: 결석만 비출석. 출석/지각/조퇴/보강 모두 출석 인정.
          CASE WHEN a.status = '결석' THEN 0.0 ELSE 1.0 END
        ) FILTER (WHERE a.id IS NOT NULL) * 100,
        1
      )
  END AS attendance_rate,
  MAX(a.attended_at) AS last_attended_at,
  MAX(e.paid_at) AS last_paid_at,
  COALESCE(sr.region, '기타') AS region
FROM public.crm_students s
LEFT JOIN public.crm_enrollments e    ON e.student_id = s.id
LEFT JOIN public.crm_attendances a    ON a.student_id = s.id
LEFT JOIN public.crm_school_regions sr ON sr.school = s.school
GROUP BY s.id, sr.region;

COMMENT ON VIEW public.student_profiles IS
  '학생 프로필 (crm_* curated layer 기반). 0056 에서 attendance_rate 산식을 0029 의 attendance row 기반 식으로 복원 — 비-방배: (전체 - 결석)/전체, 방배: (출석+지각+보강)/전체. 0049/0051 의 enrollment_count 기반 산식은 단위 mismatch 로 잘못된 결과 (송지후 사례) → 폐기.';
COMMENT ON COLUMN public.student_profiles.attendance_rate IS
  '출석률 (분원별 분기, 소수 1자리). 방배: (출석+지각+보강)/전체 attendance row. 그 외: (전체-결석)/전체 attendance row — 지각·조퇴·보강 모두 출석 인정. attendance 행이 0이면 NULL.';

COMMIT;
