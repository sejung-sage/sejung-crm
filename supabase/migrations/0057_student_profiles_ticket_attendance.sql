-- ============================================================
-- 0057_student_profiles_ticket_attendance.sql
-- student_profiles.attendance_rate 를 분원별 source 로 분기.
-- ------------------------------------------------------------
-- 배경 (운영팀 인터뷰 + raw 데이터 분석 — 2026-05-19):
--   방배 분원은 V_Attend_List 에 출석/지각/보강/조퇴/결석 5종을 모두 기록.
--   하지만 대치·반포·송도 분원은 V_Attend_List 에 사실상 "결석"만 기록되고,
--   출석은 **티켓(수강권) 사용** 으로 표현된다.
--     - aca_tickets.used_at IS NOT NULL AND used_at <> '2050-01-01 sentinel' → 수업 출석
--     - aca_tickets.used_at = '2050-01-01' → 미사용 (잔여 회차)
--     - payment_state='결제완료' (98.3%) 가 유효 ticket. '결제전' (1.7%) 은 제외.
--
-- 기존 0056 의 비-방배 산식은 attendance row 기반:
--   AVG(CASE WHEN status='결석' THEN 0 ELSE 1 END) FILTER (WHERE a.id IS NOT NULL)
--   → 결석만 기록되는 분원에서는 분모/분자 모두 결석 row 만 잡혀 0%~NULL 로 회귀.
--   대치 재원생 5,498명 중 70% 가 출석률 빈값. 휘문고 정지우 (수업 6건 등록) 도 NULL.
--
-- 새 산식 (분원별 source 분기):
--   방배: 기존 attendance row 기반 유지
--     AVG(CASE WHEN status IN ('출석','지각','보강') THEN 1 ELSE 0 END)
--       FILTER (WHERE a.id IS NOT NULL) * 100
--   대치/반포/송도: aca_tickets 기반 — 결제완료 ticket 중 실 사용 비율
--     분모: payment_state='결제완료' ticket 수
--     분자: 위 중 used_at IS NOT NULL AND used_at < '2050-01-01'
--     ticket 0건이면 NULL (신규 등록자·미결제자 등).
--
-- 구현 — GROUP BY 폭증 방지 위해 attendance_rate 만 scalar correlated subquery 로 분리.
--   다른 집계(enrollment_count·total_paid·subjects·teachers·last_*)는 0056 그대로 유지.
--   crm_students.aca2000_id ↔ aca_tickets.aca_student_id 로 join.
--   페이지네이션(50건) 단위 조회라 N+1 영향 미미.
--
-- 영향 범위:
--   대치/반포/송도 재원생 ≈ 8.5K 명의 attendance_rate 가 ticket 기반으로 재산출.
--   방배는 변경 없음.
--   last_attended_at 은 비-방배 분원에서 ticket.used_at MAX 가 더 정확하지만
--   사용자 미요청 — 일단 기존 attendance.attended_at MAX 유지 (follow-up).
--
-- 함수 내부의 view 정의 박힘 여부 확인:
--   0031 sweep_stalled_campaigns 는 campaigns 만 다뤄 view 무관.
--   0051 apply_aca_to_crm() 도 view 미참조 — crm_* 테이블 직접 UPSERT.
--   따라서 본 파일에서 view 만 교체하면 충분.
--
-- 롤백:
--   DROP VIEW IF EXISTS public.student_profiles;
--   0056_student_profiles_attendance_rate_fix.sql 의 CREATE VIEW 블록 재실행.
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
  MAX(a.attended_at) AS last_attended_at,
  MAX(e.paid_at) AS last_paid_at,
  COALESCE(sr.region, '기타') AS region
FROM public.crm_students s
LEFT JOIN public.crm_enrollments e    ON e.student_id = s.id
LEFT JOIN public.crm_attendances a    ON a.student_id = s.id
LEFT JOIN public.crm_school_regions sr ON sr.school = s.school
GROUP BY s.id, sr.region;

COMMENT ON VIEW public.student_profiles IS
  '학생 프로필 (crm_* curated layer 기반). 0057 에서 attendance_rate 를 분원별 source 로 분기 — 방배: attendance row, 그 외: aca_tickets.used_at 의 sentinel(2050-01-01) 여부 기반.';
COMMENT ON COLUMN public.student_profiles.attendance_rate IS
  '출석률 (분원별 분기, 소수 1자리). 방배: (출석+지각+보강)/전체 attendance row, attendance 0행이면 NULL. 대치/반포/송도: payment_state=결제완료 ticket 중 used_at<2050-01-01 비율, ticket 0건이면 NULL.';

COMMIT;
