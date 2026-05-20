-- ============================================================
-- 0060_student_profiles_active_count.sql
-- student_profiles view 확장 :
--   + active_enrollment_count (진행 중 수강 개수)
--   + absent_count            (결석 횟수)
-- ------------------------------------------------------------
-- 배경 (운영팀 피드백 2026-05-19 · #2, #5):
--   #2 학생 명단의 '최근 수강' 컬럼이 직관성이 떨어진다는 피드백.
--      → '수강 중인 강의 개수' 로 교체 (UI 단에서 컬럼 헤더 변경).
--   #5 출석/결석 정보가 학생 명단에서 한눈에 안 보인다.
--      → '결석 수' 컬럼을 추가.
--
-- 두 컬럼 모두 분원 무관 산식:
--   active_enrollment_count
--     = COUNT(DISTINCT e.id) FILTER (
--         WHERE (e.end_date IS NULL OR e.end_date >= CURRENT_DATE)
--           AND e.subject IS DISTINCT FROM '설명회'
--       )
--     - end_date NULL 은 Aca2000 미정/장기 강좌. 진행 중으로 인정.
--     - end_date '2050-01-01' 등 Aca2000 sentinel 도 자동 진행 중 처리.
--     - 설명회는 0058 에서 enum 으로 분리됐고, 수강 실체가 아니라 제외.
--     - subject 가 NULL 인 enrollment 도 일단 카운트 (강좌 매칭 실패 케이스).
--   absent_count
--     = COUNT(*) FILTER (WHERE a.status = '결석')
--     - 결석은 모든 분원(방배/대치/반포/송도)이 V_Attend_List 에 동일하게
--       기록 — 0057 의 분원별 출석률 분기와 달리 단일 산식 가능.
--     - aca_tickets 기반 출석 데이터는 '결석' 상태가 없으므로 사용 안 함.
--
-- attendance_rate 산식 (분원별 분기) 은 0057 그대로 유지.
-- 다른 모든 컬럼도 0057 동일.
--
-- 롤백:
--   DROP VIEW IF EXISTS public.student_profiles;
--   0057_student_profiles_ticket_attendance.sql 의 CREATE VIEW 재실행.
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
  -- 진행 중 수강 (end_date 미정 또는 미래) + 설명회 제외.
  COUNT(DISTINCT e.id) FILTER (
    WHERE (e.end_date IS NULL OR e.end_date >= CURRENT_DATE)
      AND e.subject IS DISTINCT FROM '설명회'
  ) AS active_enrollment_count,
  COALESCE(SUM(e.amount), 0)::BIGINT AS total_paid,
  ARRAY_AGG(DISTINCT e.subject)
    FILTER (WHERE e.subject IS NOT NULL) AS subjects,
  ARRAY_AGG(DISTINCT e.teacher_name)
    FILTER (WHERE e.teacher_name IS NOT NULL) AS teachers,
  -- attendance_rate 만 scalar correlated subquery 로 분리 — GROUP BY 영향 없음.
  (
    CASE
      WHEN s.branch = '방배' THEN (
        -- 방배: attendance row 5종 분기. 출석/지각/보강 만 출석 인정.
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
        -- 대치/반포/송도: 결제완료 ticket 중 used_at 가 sentinel 이 아닌 비율.
        -- ticket 0건이면 NULL (CASE 가 NULL 반환).
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
  -- 결석 수 — 분원 무관 단일 산식. attendance.status='결석' 행 수.
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
  '학생 프로필 (crm_* curated layer 기반). 0060 에서 active_enrollment_count + absent_count 추가 — 학생 명단 컬럼 변경 (#2, #5).';
COMMENT ON COLUMN public.student_profiles.active_enrollment_count IS
  '진행 중 수강 개수. end_date 가 NULL 이거나 오늘 이후인 enrollment 중 subject<>설명회. 분원 무관 단일 산식.';
COMMENT ON COLUMN public.student_profiles.absent_count IS
  '결석 횟수 (crm_attendances.status=결석 row count). 모든 분원이 V_Attend_List 에 결석을 기록하므로 분원 무관.';
COMMENT ON COLUMN public.student_profiles.attendance_rate IS
  '출석률 (분원별 분기, 소수 1자리). 방배: (출석+지각+보강)/전체 attendance row, attendance 0행이면 NULL. 대치/반포/송도: payment_state=결제완료 ticket 중 used_at<2050-01-01 비율, ticket 0건이면 NULL.';

COMMIT;
