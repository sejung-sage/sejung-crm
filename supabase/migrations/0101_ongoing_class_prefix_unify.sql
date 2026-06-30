-- ============================================================
-- 0101_ongoing_class_prefix_unify.sql
-- "진행 중 강좌" 판정을 종강 접두((종)/(폐))까지 반영하도록 통일 + 회귀 fix.
-- ------------------------------------------------------------
-- 배경 (2026-06-30 운영 진단):
--   두 증상이 같은 뿌리에서 나옴.
--   (A) 설명회만 듣는 학생이 '재원생' 으로 분류 (예: 조재후, 대치 2,470명+).
--   (B) 종강된 강좌가 '수강 중' 으로 카운트 (예: 권준서 — '종)26@RN [1-기말]'
--       강좌가 end_date='2050-01-01' sentinel 이라 active 로 잡혀 수강중 2개).
--
--   원인 1 — 회귀: 0072(timeout fix)가 apply_aca_to_crm() 를 0051 기준으로
--     재작성하면서 0058 의 설명회 제외 + '수강 x' 3분류를 통째로 되돌림.
--     → active_set 이 설명회/종강 구분 없이 end_date 만 봄 → (A).
--   원인 2 — 신호 불일치: 상세 패널은 course-progress.ts 가 강좌명 접두
--     ((종)/(폐))로 종강을 판정(end_date sentinel 신뢰 불가라 폐기). 그런데
--     student_profiles.active_enrollment_count 와 status 는 여전히 end_date 기반
--     → 패널(진행 중)과 목록(수강 중) 이 어긋남 → (B).
--
-- 해결 — "진행 중 강좌" 단일 정의(교집합):
--     end_date 미래/NULL  AND  설명회 아님  AND  종강·폐강 접두 아님
--   설명회·접두 부분을 IMMUTABLE 헬퍼 crm_class_is_ongoing(name, subject) 로
--   단일화(planner 가 inline). end_date(회차/등록 기준)는 호출부에서 결합.
--   course-progress.ts(CLOSED_PREFIXES = (종)/종)/(폐)/폐)) 와 동일 규칙.
--
-- 변경:
--   1) 헬퍼 crm_class_is_ongoing(text, text) 생성.
--   2) student_profiles 뷰 재정의 — active_enrollment_count 가 헬퍼 사용
--      (0066 그대로 + 그 서브쿼리만 교체).
--   3) apply_aca_to_crm() 재정의 — active_set 헬퍼 사용 + any_enrollment_set
--      (설명회 외 수강 이력) + '수강 x' 3분류 복원. 0072 의 timeout/UPSERT 유지.
--   4) crm_students.status 즉시 백필 — 새 규칙으로 재계산(탈퇴 보존).
--
-- 적용 후: 권준서 수강중 1개, 조재후 '수강 x'. 재원생 수 감소(설명회·종강만 학생 제외).
--
-- 롤백(수동): 0066 뷰 + 0072 함수 재실행 후 DROP FUNCTION crm_class_is_ongoing.
-- ============================================================

BEGIN;

SET LOCAL statement_timeout = '10min';

-- ── 1) 진행 대상 강좌 판정 헬퍼 (설명회·종강접두 제외) ──────────
-- IMMUTABLE — 입력(name, subject)만 의존, CURRENT_DATE 미사용(날짜는 호출부 결합).
-- SQL IMMUTABLE 이라 planner 가 inline → 대용량 집계에서도 추가 함수콜 비용 없음.
CREATE OR REPLACE FUNCTION public.crm_class_is_ongoing(
  p_name text,
  p_subject text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_subject IS DISTINCT FROM '설명회'
     AND btrim(COALESCE(p_name, '')) !~ '^(\(종\)|종\)|\(폐\)|폐\))';
$$;

COMMENT ON FUNCTION public.crm_class_is_ongoing(text, text) IS
  '강좌가 진행 대상인지 — 설명회 아님 AND 종강/폐강 접두((종)/종)/(폐)/폐)) 아님. '
  'course-progress.ts 의 CLOSED_PREFIXES·isSeminarCourse 와 동일 규칙(단일 출처). '
  'end_date(진행 중) 조건은 호출부에서 AND 결합. 0101.';

-- ── 2) student_profiles 뷰 — active_enrollment_count 가 헬퍼 사용 ──
-- 0066 정의 그대로, active_enrollment_count 서브쿼리의 WHERE 만 교체.
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
      AND public.crm_class_is_ongoing(c2.name, c2.subject)
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
  '학생 프로필 (crm_* curated layer). 0101 — active_enrollment_count 가 crm_class_is_ongoing(설명회+종강접두 제외)로 판정. 패널 진행 중 규칙과 일치.';

-- ── 3) apply_aca_to_crm() — 진행 중 규칙 통일 + 수강 x 복원 ──────
CREATE OR REPLACE FUNCTION public.apply_aca_to_crm()
RETURNS TABLE(
  students_upserted bigint,
  classes_upserted bigint,
  enrollments_upserted bigint,
  attendances_upserted bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_students bigint;
  v_classes bigint;
  v_enrollments bigint;
  v_attendances bigint;
BEGIN
  SET LOCAL statement_timeout = '20min';

  -- 진행 중(재원생): end_date 미래 AND 설명회·종강접두 아님.
  WITH active_set AS (
    SELECT DISTINCT e.student_id
    FROM public.aca_enrollments e
    LEFT JOIN public.aca_classes c ON c.aca_class_id = e.aca_class_id
    WHERE (e.end_date IS NULL OR e.end_date >= CURRENT_DATE)
      AND public.crm_class_is_ongoing(c.name, c.subject)
  ),
  -- 수강 이력(수강이력자): 설명회 외 강좌를 한 번이라도 수강(종강/과거 포함).
  any_enrollment_set AS (
    SELECT DISTINCT e.student_id
    FROM public.aca_enrollments e
    LEFT JOIN public.aca_classes c ON c.aca_class_id = e.aca_class_id
    WHERE (c.subject IS DISTINCT FROM '설명회')
  ),
  school_candidate AS (
    SELECT
      e.student_id,
      ks.school,
      COUNT(*) AS hits
    FROM public.aca_enrollments e
    JOIN public.aca_classes c ON c.aca_class_id = e.aca_class_id
    JOIN public.crm_school_regions ks ON c.name LIKE '%' || ks.school || '%'
    WHERE LENGTH(ks.school) >= 2
    GROUP BY e.student_id, ks.school
  ),
  best_school AS (
    SELECT DISTINCT ON (student_id)
      student_id, school
    FROM school_candidate
    ORDER BY student_id, hits DESC, LENGTH(school) DESC
  ),
  src AS (
    SELECT
      a.id, a.aca2000_id, a.name, a.phone, a.parent_phone,
      COALESCE(a.school, bs.school) AS school,
      a.grade, a.grade_raw, a.school_level,
      CASE
        WHEN a.status = '탈퇴' THEN '탈퇴'
        WHEN a.id IN (SELECT student_id FROM active_set) THEN '재원생'
        WHEN a.id IN (SELECT student_id FROM any_enrollment_set) THEN '수강이력자'
        ELSE '수강 x'
      END AS status,
      a.branch, a.registered_at,
      a.created_at, a.updated_at
    FROM public.aca_students a
    LEFT JOIN best_school bs ON bs.student_id = a.id
  ),
  ups AS (
    INSERT INTO public.crm_students (
      id, aca2000_id, name, phone, parent_phone, school,
      grade, grade_raw, school_level, status, branch, registered_at,
      created_at, updated_at
    )
    SELECT
      id, aca2000_id, name, phone, parent_phone, school,
      grade, grade_raw, school_level, status, branch, registered_at,
      created_at, updated_at
    FROM src
    ON CONFLICT (id) DO UPDATE SET
      aca2000_id   = EXCLUDED.aca2000_id,
      name         = EXCLUDED.name,
      phone        = EXCLUDED.phone,
      parent_phone = EXCLUDED.parent_phone,
      school       = EXCLUDED.school,
      grade        = EXCLUDED.grade,
      grade_raw    = EXCLUDED.grade_raw,
      school_level = EXCLUDED.school_level,
      status       = EXCLUDED.status,
      branch       = EXCLUDED.branch,
      registered_at= EXCLUDED.registered_at,
      updated_at   = now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_students FROM ups;

  WITH ups AS (
    INSERT INTO public.crm_classes
      SELECT * FROM public.aca_classes
    ON CONFLICT (id) DO UPDATE SET
      aca_class_id       = EXCLUDED.aca_class_id,
      branch             = EXCLUDED.branch,
      name               = EXCLUDED.name,
      teacher_name       = EXCLUDED.teacher_name,
      subject_raw        = EXCLUDED.subject_raw,
      subject            = EXCLUDED.subject,
      total_sessions     = EXCLUDED.total_sessions,
      amount_per_session = EXCLUDED.amount_per_session,
      total_amount       = EXCLUDED.total_amount,
      capacity           = EXCLUDED.capacity,
      schedule_days      = EXCLUDED.schedule_days,
      schedule_time      = EXCLUDED.schedule_time,
      start_date         = EXCLUDED.start_date,
      end_date           = EXCLUDED.end_date,
      active             = EXCLUDED.active,
      updated_at         = now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_classes FROM ups;

  WITH ups AS (
    INSERT INTO public.crm_enrollments
      SELECT * FROM public.aca_enrollments
    ON CONFLICT (id) DO UPDATE SET
      student_id    = EXCLUDED.student_id,
      course_name   = EXCLUDED.course_name,
      teacher_name  = EXCLUDED.teacher_name,
      subject       = EXCLUDED.subject,
      amount        = EXCLUDED.amount,
      paid_at       = EXCLUDED.paid_at,
      start_date    = EXCLUDED.start_date,
      end_date      = EXCLUDED.end_date,
      aca_class_id  = EXCLUDED.aca_class_id,
      updated_at    = now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_enrollments FROM ups;

  WITH ups AS (
    INSERT INTO public.crm_attendances
      SELECT * FROM public.aca_attendances
    ON CONFLICT (id) DO UPDATE SET
      student_id    = EXCLUDED.student_id,
      enrollment_id = EXCLUDED.enrollment_id,
      attended_at   = EXCLUDED.attended_at,
      status        = EXCLUDED.status
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_attendances FROM ups;

  RETURN QUERY SELECT v_students, v_classes, v_enrollments, v_attendances;
END;
$$;

COMMENT ON FUNCTION public.apply_aca_to_crm() IS
  'ETL 직후 호출 — aca_*→crm_* 정제 UPSERT. 0101 — active_set 이 crm_class_is_ongoing(설명회+종강접두 제외)로 판정, any_enrollment_set(설명회 외 이력)으로 수강이력자/수강 x 3분류 복원. 0072 의 statement_timeout 20min 유지.';

-- ── 4) crm_students.status 즉시 백필 (새 규칙 재계산, 탈퇴 보존) ──
-- 다음 ETL 까지 기다리지 않고 현 데이터에 바로 반영. crm_* 기준(다음 apply 결과와 동일).
WITH active_real AS (
  SELECT DISTINCT e.student_id
  FROM public.crm_enrollments e
  LEFT JOIN public.crm_classes c ON c.aca_class_id = e.aca_class_id
  WHERE (e.end_date IS NULL OR e.end_date >= CURRENT_DATE)
    AND public.crm_class_is_ongoing(c.name, c.subject)
),
any_real AS (
  SELECT DISTINCT e.student_id
  FROM public.crm_enrollments e
  LEFT JOIN public.crm_classes c ON c.aca_class_id = e.aca_class_id
  WHERE (c.subject IS DISTINCT FROM '설명회')
)
UPDATE public.crm_students s
SET status = CASE
      WHEN s.id IN (SELECT student_id FROM active_real) THEN '재원생'
      WHEN s.id IN (SELECT student_id FROM any_real)    THEN '수강이력자'
      ELSE '수강 x'
    END,
    updated_at = now()
WHERE s.status <> '탈퇴'
  AND s.status IS DISTINCT FROM (
    CASE
      WHEN s.id IN (SELECT student_id FROM active_real) THEN '재원생'
      WHEN s.id IN (SELECT student_id FROM any_real)    THEN '수강이력자'
      ELSE '수강 x'
    END
  );

COMMIT;
