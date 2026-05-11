-- 0030_student_profiles_attendance_rate_v2.sql
-- public.student_profiles VIEW 의 attendance_rate 식을 분원별 분기 + 분모 변경.
--
-- 운영 정책 변경 (사용자 확정 · 2026-05-08):
--   "결석이 아닌 것은 다 출석으로 처리" — non-방배 분원은 출석 row 가 명시적으로
--   기록되지 않은 수강(예: ETL 미적재 / 보존기간 초과 / 운영 단순화) 도 출석으로
--   간주한다. 즉 분모는 attendance row 수가 아니라 enrollment_count.
--
-- 분기:
--   - 방배 : (출석 + 지각 + 보강) / 전체 attendance row    (5종 raw, 0029 유지)
--   - 그 외: (enrollment_count - 결석 수) / enrollment_count
--             결석 수 > enrollment_count 인 비정상 케이스는 GREATEST 로 0% 클램프.
--             enrollment_count = 0 이면 NULL (데이터 없음 표시).
--
-- 변경 전 (0029 식 — non-방배 부분):
--   AVG(CASE WHEN a.status = '결석' THEN 0.0 ELSE 1.0 END FILTER ...) * 100
--   → 분모 = attendance row 수. attendance 가 결석 1건만 있으면 0%.
--
-- 변경 후 (0030):
--   GREATEST(COUNT(DISTINCT e.id) - COUNT(DISTINCT a.id) FILTER (status='결석'), 0)
--   / COUNT(DISTINCT e.id) * 100
--   → 분모 = enrollment_count. 결석 row 수만 차감.
--
-- 카테시안 주의:
--   LEFT JOIN enrollments + LEFT JOIN attendances 가 곱해져 row 폭증해도
--   COUNT(DISTINCT ...) 가 정확한 카운트를 보장. AVG/SUM 류 식은 cartesian 영향
--   받을 수 있으므로 본 마이그에서는 모두 DISTINCT 기반으로 작성.
--
-- 영향 범위 (DB view):
--   - 학생 명단(/students) attendance_rate 컬럼·정렬
--   - 학생 상세(/students/[id]) KPI "출석률"
--   - 발송 그룹 빌더 미리보기 sample.attendance_rate
--
-- 강좌 KPI(/classes/[id]) 평균 출석률 은 별도 — class-kpi-cards 가 attendance row
-- 기반으로 자체 계산. 의미 차이(강좌 단위 vs 학생 단위) 로 본 변경 미적용.
--
-- 다른 컬럼/구조는 0029 그대로 유지 (region 컬럼 + school_regions LEFT JOIN).
--
-- ROLLBACK 계획:
--   BEGIN;
--     DROP VIEW IF EXISTS public.student_profiles;
--     -- 0029 정의 복원 (CASE WHEN status='결석' THEN 0 ELSE 1 식)
--   COMMIT;

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
  CASE
    WHEN s.branch = '방배' THEN
      -- 방배: 5종 raw 룰 (0029 유지). 분모 = attendance row 수.
      -- attendance row 자체가 0 이면 AVG 결과 NULL → 화면 "—".
      ROUND(
        AVG(
          CASE WHEN a.status IN ('출석', '지각', '보강') THEN 1.0 ELSE 0.0 END
        ) FILTER (WHERE a.id IS NOT NULL) * 100,
        1
      )
    ELSE
      -- 그 외: 분모 = enrollment_count, 분자 = enrollment_count - 결석 distinct.
      -- enrollment_count = 0 이면 NULL.
      CASE
        WHEN COUNT(DISTINCT e.id) = 0 THEN NULL
        ELSE
          ROUND(
            (
              GREATEST(
                COUNT(DISTINCT e.id)
                  - COUNT(DISTINCT a.id) FILTER (WHERE a.status = '결석'),
                0
              )::numeric
              / COUNT(DISTINCT e.id)
            ) * 100,
            1
          )
      END
  END AS attendance_rate,
  MAX(a.attended_at) AS last_attended_at,
  MAX(e.paid_at) AS last_paid_at,
  COALESCE(sr.region, '기타') AS region
FROM public.students s
LEFT JOIN public.enrollments e   ON e.student_id = s.id
LEFT JOIN public.attendances a   ON a.student_id = s.id
LEFT JOIN public.school_regions sr ON sr.school = s.school
GROUP BY s.id, sr.region;

COMMENT ON VIEW public.student_profiles IS
  '학생 프로필 (students + enrollments + attendances 집계 + school_regions 지역 매핑). 0030 에서 비-방배 attendance_rate 분모를 attendance row 수 → enrollment_count 로 변경 — "결석이 아닌 모든 수강은 출석" 정책.';
COMMENT ON COLUMN public.student_profiles.grade IS
  '정규화된 학년 (중1~고3/재수/졸업/미정 9종). UI 필터 대상.';
COMMENT ON COLUMN public.student_profiles.grade_raw IS
  '아카 V_student_list.학년 원본 값. 디버그·ETL 재처리용.';
COMMENT ON COLUMN public.student_profiles.school_level IS
  '학교급 (중/고/기타). UI 1차 필터.';
COMMENT ON COLUMN public.student_profiles.enrollment_count IS '총 수강 횟수';
COMMENT ON COLUMN public.student_profiles.total_paid IS '총 결제 금액 (원 단위)';
COMMENT ON COLUMN public.student_profiles.subjects IS '수강 과목 목록';
COMMENT ON COLUMN public.student_profiles.teachers IS '수강한 강사 목록';
COMMENT ON COLUMN public.student_profiles.attendance_rate IS
  '출석률 (분원 분기, 소수 1자리). 방배: (출석+지각+보강)/전체 attendance row. 그 외: (enrollment_count - 결석 distinct)/enrollment_count — 결석 row 만 비출석, 데이터 없는 수강도 출석 간주. 0030 변경.';
COMMENT ON COLUMN public.student_profiles.last_attended_at IS '마지막 출석일';
COMMENT ON COLUMN public.student_profiles.last_paid_at IS '마지막 결제일';
COMMENT ON COLUMN public.student_profiles.region IS
  '지역명 (예: "강남구", "서초구"). school_regions LEFT JOIN 결과. 매칭 실패/학교 NULL 시 ''기타''. 학생 명단/발송 그룹의 지역 필터 대상. 0026 추가.';

COMMIT;
