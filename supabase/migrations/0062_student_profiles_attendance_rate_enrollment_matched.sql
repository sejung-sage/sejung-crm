-- ============================================================
-- 0062_student_profiles_attendance_rate_enrollment_matched.sql
-- student_profiles.attendance_rate — enrollment 매칭 attendance 만 카운트.
-- ------------------------------------------------------------
-- 문제 (현장 사례 · 한승주, 대치 중3):
--   - 1 enrollment (2회차 강좌) · attendance 2회 모두 '출석' · 결석 0회
--   - UI 격자 표기: 출석률 100% 가 기대
--   - 그런데 KPI 카드는 18.2% 표시
--
-- 원인:
--   0061 의 attendance_rate 가 비-방배 분원에서 aca_tickets 기반:
--     COUNT(*) FILTER (payment_state='결제완료' AND used_at IS NOT NULL
--                       AND used_at < '2050-01-01')
--     / COUNT(*) FILTER (payment_state='결제완료')
--   한승주는 결제완료 ticket 11건 중 used_at 채워진 게 2건 → 2/11 = 18.2%.
--   ETL 매핑 갭 — ticket 의 used_at 이 attendance 와 정확 매칭 안 됨.
--
--   더 근본 문제: 0056 의 attendance row 기반 산식도 학생의 모든 attendance
--   (enrollment 무관) 를 분모로 잡아 다른 강좌 잔여 attendance 가 섞이면
--   격자와 KPI 가 불일치. 해결은 attendance ↔ enrollment 매칭 강제.
--
-- 수정 (모든 분원 일관):
--   attendance_rate =
--     CASE
--       (학생의 enrollment 와 매칭되는 attendance row 가 0건) → NULL
--       ELSE
--         방배:        (출석+지각+보강) / 매칭 attendance 전체
--         그 외:       (결석 제외 row) / 매칭 attendance 전체
--     END
--
--   매칭 조건: a.aca_class_id IN (해당 학생의 enrollments.aca_class_id)
--   → 학생이 등록한 강좌의 출석만 카운트. 다른 강좌(보강 청강·ETL 잔재)는
--   attendance 격자에도 안 보이고 출석률에도 영향 X — UI 일관성 확보.
--
-- 한승주 케이스 (수정 후):
--   - 매칭 attendance = 2 (5/2 출석, 5/3 출석)
--   - 결석 0 → 2/2 = 100.0
--
-- 송지후 케이스 (수정 후):
--   - 3 enrollments · 매칭 attendance = 12 (각 강좌 4회씩) · 결석 4
--   - 8/12 = 66.7  (이전 0056 fix 와 동일)
--
-- 0061 의 active_enrollment_count subquery 는 그대로 유지.
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
  -- attendance_rate — enrollment 매칭 attendance row 만 분모/분자에 포함.
  -- a.aca_class_id 가 학생의 enrollments.aca_class_id 중 하나일 때만 카운트.
  (
    SELECT
      CASE
        WHEN COUNT(*) = 0 THEN NULL
        WHEN s.branch = '방배' THEN
          ROUND(
            COUNT(*) FILTER (WHERE a2.status IN ('출석','지각','보강'))::numeric
              / COUNT(*) * 100,
            1
          )
        ELSE
          ROUND(
            COUNT(*) FILTER (WHERE a2.status <> '결석')::numeric
              / COUNT(*) * 100,
            1
          )
      END
    FROM public.crm_attendances a2
    WHERE a2.student_id = s.id
      AND a2.aca_class_id IS NOT NULL
      AND a2.aca_class_id IN (
        SELECT e3.aca_class_id
        FROM public.crm_enrollments e3
        WHERE e3.student_id = s.id
          AND e3.aca_class_id IS NOT NULL
      )
  ) AS attendance_rate,
  -- absent_count — attendance row 전체 기반 (격자·결석 수 카드와 일치).
  -- attendance_rate 와 달리 enrollment 매칭으로 좁히지 않음 — "총 결석 횟수"
  -- 시야는 enrollment 무관 모든 결석을 보여주는 게 운영자가 원하는 정보.
  COUNT(*) FILTER (WHERE a.status = '결석') AS absent_count,
  MAX(a.attended_at) AS last_attended_at,
  MAX(e.paid_at) AS last_paid_at,
  COALESCE(sr.region, '기타') AS region
FROM public.crm_students s
LEFT JOIN public.crm_enrollments e    ON e.student_id = s.id
LEFT JOIN public.crm_attendances a    ON a.student_id = s.id
LEFT JOIN public.crm_school_regions sr ON sr.school = s.school
GROUP BY s.id, sr.region;

COMMENT ON VIEW public.student_profiles IS
  '학생 프로필 (crm_* curated layer). 0062 — attendance_rate 가 enrollment 매칭 attendance row 만 카운트 (학생이 등록한 강좌의 출석만). UI 격자와 KPI 일관성 확보. ticket 기반 0061 산식은 ETL 매핑 갭으로 부정확 → 폐기.';
COMMENT ON COLUMN public.student_profiles.attendance_rate IS
  '출석률 (소수 1자리). 학생의 enrollments 와 매칭되는 attendance row 만 분모. 방배: (출석+지각+보강)/전체. 그 외: (결석 제외)/전체. 매칭 attendance 0건이면 NULL.';

COMMIT;
