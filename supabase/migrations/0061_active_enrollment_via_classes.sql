-- ============================================================
-- 0061_active_enrollment_via_classes.sql
-- student_profiles.active_enrollment_count — 설명회 제외 로직 fix.
-- ------------------------------------------------------------
-- 문제:
--   0060 의 active_enrollment_count 가 `e.subject IS DISTINCT FROM '설명회'`
--   로 설명회 제외를 시도했으나, 운영 source of truth 상 `crm_enrollments.subject`
--   는 항상 NULL (subject 정보는 classes 에만 채워짐). NULL IS DISTINCT FROM
--   '설명회' = TRUE 이므로 모든 enrollment 가 통과 → 설명회 분리 실패.
--
--   현장 사례 (정지우 휘문고 고3, 78031--256891):
--     enrollment 6건 중 진행중 1건이 '고3 3월학평 분석 및 입시전략 설명회'
--     (end_date='2050-01-01' sentinel) → 0060 에서 active=1 로 잡힘.
--     기대: 정규 강좌가 모두 종강이므로 active=0.
--
-- 해결:
--   apply_aca_to_crm() (0058) 와 동일 패턴 — LEFT JOIN crm_classes c
--   on aca_class_id 후 c.subject 로 판정.
--
-- 변경 범위:
--   active_enrollment_count subquery 만 scalar correlated 로 치환.
--   다른 컬럼 (attendance_rate, absent_count, subjects 등) 은 0060 그대로.
--
-- 롤백:
--   0060 의 CREATE VIEW 블록 재실행.
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
  -- 진행중 enrollment 중 설명회 강좌 제외 — classes.subject 로 판정.
  -- enrollments.subject 는 항상 NULL 이라 enrollments 자체로는 분리 불가.
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
  -- attendance_rate — 0060 그대로 (분원별 분기, scalar subquery).
  (
    CASE
      WHEN s.branch = '방배' THEN (
        SELECT ROUND(
          AVG(
            CASE WHEN a2.status IN ('출석', '지각', '보강') THEN 1.0 ELSE 0.0 END
          ) * 100,
          1
        )
        FROM public.crm_attendances a2
        WHERE a2.student_id = s.id
      )
      ELSE (
        SELECT
          CASE
            WHEN COUNT(*) FILTER (WHERE t.payment_state = '결제완료') = 0 THEN NULL
            ELSE ROUND(
              COUNT(*) FILTER (
                WHERE t.payment_state = '결제완료'
                  AND t.used_at IS NOT NULL
                  AND t.used_at < TIMESTAMPTZ '2050-01-01'
              )::numeric
              / COUNT(*) FILTER (WHERE t.payment_state = '결제완료')
              * 100,
              1
            )
          END
        FROM public.aca_tickets t
        WHERE t.aca_student_id = s.aca2000_id
      )
    END
  ) AS attendance_rate,
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
  '학생 프로필 (crm_* curated layer 기반). 0061 — active_enrollment_count 가 classes.subject 로 설명회 제외 (enrollments.subject 가 항상 NULL 인 source of truth 반영).';
COMMENT ON COLUMN public.student_profiles.active_enrollment_count IS
  '진행 중 수강 개수 — end_date 가 NULL 이거나 미래 + crm_classes.subject<>설명회. classes join 으로 판정 (enrollments.subject 는 항상 NULL).';
COMMENT ON COLUMN public.student_profiles.absent_count IS
  '결석 횟수 (crm_attendances.status=결석 row count). 분원 무관.';
COMMENT ON COLUMN public.student_profiles.attendance_rate IS
  '출석률 (분원별 분기, 소수 1자리). 방배: (출석+지각+보강)/전체 attendance row. 대치/반포/송도: payment_state=결제완료 ticket 중 used_at<2050-01-01 비율. ticket 또는 attendance 0건이면 NULL.';

COMMIT;
