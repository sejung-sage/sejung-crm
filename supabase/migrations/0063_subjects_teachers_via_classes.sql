-- ============================================================
-- 0063_subjects_teachers_via_classes.sql
-- student_profiles.subjects / teachers 를 classes 와 join 해서 산출.
-- ------------------------------------------------------------
-- 문제:
--   subjects · teachers 가 enrollments 컬럼을 ARRAY_AGG 했는데,
--   운영 source of truth 상 crm_enrollments.subject / teacher_name 은
--   항상 NULL (강좌 메타는 classes 에만 채워짐). 결과 두 컬럼 모두 NULL
--   → 그룹 빌더·학생 명단의 '과목' / '강사' 필터가 0명 매칭.
--
--   현장 사례 (2026-05-20):
--     발송 그룹 빌더에서 '재원생 + 인천 송도 + 국어' 필터 → 0명.
--     송도 재원생 575명이지만 국어 매칭 0건. subjects 가 빈 배열이라.
--
-- 변경:
--   FROM 절에 LEFT JOIN crm_classes c ON c.aca_class_id = e.aca_class_id
--   추가 (1 enrollment = 1 class, cartesian 영향 없음).
--
--   subjects ─ 진행 중인 강좌의 c.subject 만 ARRAY_AGG.
--     '설명회' 는 운영 정책상 수업 아님 → 제외.
--     '진행 중' 판정: e.end_date IS NULL OR e.end_date >= CURRENT_DATE
--     의도: '국어 듣는 학생' = '현재 국어 강좌 수강중' (사용자 기대).
--
--   teachers ─ 진행 중인 강좌의 c.teacher_name ARRAY_AGG.
--     역시 '진행 중' 한정. '설명회' 강좌 강사도 표시 가치 낮아 함께 제외.
--
-- 영향:
--   - 그룹 빌더 / 학생 명단 / KPI 의 과목·강사 필터가 정상 동작
--   - 과거 수강 과목은 view 에 안 나옴 (정책 변경 — '진행 중 기준')
--   - active_enrollment_count / attendance_rate 등 다른 컬럼은 0061
--     그대로
--
-- 롤백:
--   0061 의 CREATE VIEW 재실행.
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
  -- subjects/teachers — 진행 중 강좌의 classes 메타로 산출.
  -- enrollments.subject / teacher_name 은 항상 NULL.
  ARRAY_AGG(DISTINCT c.subject)
    FILTER (
      WHERE c.subject IS NOT NULL
        AND c.subject <> '설명회'
        AND (e.end_date IS NULL OR e.end_date >= CURRENT_DATE)
    ) AS subjects,
  ARRAY_AGG(DISTINCT c.teacher_name)
    FILTER (
      WHERE c.teacher_name IS NOT NULL
        AND (c.subject IS DISTINCT FROM '설명회')
        AND (e.end_date IS NULL OR e.end_date >= CURRENT_DATE)
    ) AS teachers,
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
LEFT JOIN public.crm_classes     c    ON c.aca_class_id = e.aca_class_id
LEFT JOIN public.crm_attendances a    ON a.student_id = s.id
LEFT JOIN public.crm_school_regions sr ON sr.school = s.school
GROUP BY s.id, sr.region;

COMMENT ON VIEW public.student_profiles IS
  '학생 프로필 (crm_* curated layer). 0063 — subjects/teachers 를 진행 중 강좌의 classes.subject/teacher_name 로 산출 (enrollments.subject 가 항상 NULL 인 source of truth 반영).';
COMMENT ON COLUMN public.student_profiles.subjects IS
  '현재 수강 중인 강좌의 과목 배열 (설명회 제외). classes.subject 기반.';
COMMENT ON COLUMN public.student_profiles.teachers IS
  '현재 수강 중인 강좌의 강사 배열 (설명회 제외). classes.teacher_name 기반.';
COMMENT ON COLUMN public.student_profiles.active_enrollment_count IS
  '진행 중 수강 개수 — end_date 가 NULL 이거나 미래 + classes.subject<>설명회.';
COMMENT ON COLUMN public.student_profiles.absent_count IS
  '결석 횟수 (crm_attendances.status=결석 row count). 분원 무관.';
COMMENT ON COLUMN public.student_profiles.attendance_rate IS
  '출석률 (분원별 분기, 소수 1자리). 방배: (출석+지각+보강)/전체 attendance row. 대치/반포/송도: payment_state=결제완료 ticket 중 used_at<2050-01-01 비율. ticket 또는 attendance 0건이면 NULL.';

COMMIT;
