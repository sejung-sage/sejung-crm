-- 0070_classes_season.sql
-- 강좌 시즌 분류 컬럼 추가 — aca_classes / crm_classes 양쪽에 season TEXT NULL.
--
-- 사용자 결정 (2026-05-22):
--   1. raw(aca_classes) 에 시즌 태그 없음 — 방배만 일부, 4분원 정책 다름 → 자동 분류 X
--   2. season 컬럼만 추가하고 운영팀이 강좌마다 수동 선택
--   3. enum 6종: 여름방학특강 / 겨울방학특강 / 내신 / 상반기정규 / 하반기정규 / 기타
--   4. ETL upsert(apply_aca_to_crm) 시 raw 가 NULL 이면 기존 crm 값 유지 (COALESCE)
--      → 운영팀이 crm 에 입력한 시즌이 다음 ETL 에 덮어쓰이지 않도록 보존
--
-- 단계:
--   1) aca_classes.season ADD COLUMN + CHECK + INDEX + COMMENT
--   2) crm_classes.season ADD COLUMN + CHECK + INDEX + COMMENT
--   3) apply_aca_to_crm() CREATE OR REPLACE — UPDATE 절에 season COALESCE 추가,
--      INSERT 절에 season 추가 (모두 raw 측 컬럼이 NULL 이므로 첫 적재 NULL)
--
-- 롤백 (수동):
--   ALTER TABLE public.aca_classes DROP CONSTRAINT IF EXISTS aca_classes_season_check;
--   ALTER TABLE public.crm_classes DROP CONSTRAINT IF EXISTS crm_classes_season_check;
--   DROP INDEX IF EXISTS public.idx_aca_classes_season;
--   DROP INDEX IF EXISTS public.idx_crm_classes_season;
--   ALTER TABLE public.aca_classes DROP COLUMN IF EXISTS season;
--   ALTER TABLE public.crm_classes DROP COLUMN IF EXISTS season;
--   -- 그리고 apply_aca_to_crm() 을 0058 정의로 되돌릴 것.

BEGIN;

SET LOCAL statement_timeout = '5min';

-- ── 1) aca_classes.season ─────────────────────────────────────
-- raw 레이어에도 컬럼 보존 — 향후 raw 측에서 자동 분류 룰이 생기거나
-- 외부 적재 단계에서 시즌 태그가 들어오는 경우를 대비. 현재는 항상 NULL.
ALTER TABLE public.aca_classes
  ADD COLUMN IF NOT EXISTS season TEXT NULL;

ALTER TABLE public.aca_classes
  DROP CONSTRAINT IF EXISTS aca_classes_season_check;

ALTER TABLE public.aca_classes
  ADD CONSTRAINT aca_classes_season_check
  CHECK (
    season IS NULL
    OR season IN
      ('여름방학특강', '겨울방학특강', '내신', '상반기정규', '하반기정규', '기타')
  );

COMMENT ON COLUMN public.aca_classes.season IS
  '강좌 시즌 분류 (여름방학특강/겨울방학특강/내신/상반기정규/하반기정규/기타). raw 레이어 현재는 항상 NULL — 외부 자동 분류 도입 시를 위한 컬럼.';

CREATE INDEX IF NOT EXISTS idx_aca_classes_season
  ON public.aca_classes (season);

-- ── 2) crm_classes.season ─────────────────────────────────────
-- 운영팀 수동 입력 대상. 강좌별 1회 선택 → CRM 페이지에서 dropdown 으로 갱신.
ALTER TABLE public.crm_classes
  ADD COLUMN IF NOT EXISTS season TEXT NULL;

ALTER TABLE public.crm_classes
  DROP CONSTRAINT IF EXISTS crm_classes_season_check;

ALTER TABLE public.crm_classes
  ADD CONSTRAINT crm_classes_season_check
  CHECK (
    season IS NULL
    OR season IN
      ('여름방학특강', '겨울방학특강', '내신', '상반기정규', '하반기정규', '기타')
  );

COMMENT ON COLUMN public.crm_classes.season IS
  '강좌 시즌 분류 (여름방학특강/겨울방학특강/내신/상반기정규/하반기정규/기타). 운영팀 수동 선택. apply_aca_to_crm() 재실행 시 COALESCE 로 기존 값 보존.';

CREATE INDEX IF NOT EXISTS idx_crm_classes_season
  ON public.crm_classes (season);

-- ── 3) apply_aca_to_crm() 갱신 — season COALESCE 보존 ───────
-- 0058 의 함수에서 crm_classes INSERT/UPDATE 절에 season 추가.
-- 핵심:
--   ON CONFLICT DO UPDATE 절에서 season = COALESCE(EXCLUDED.season, existing)
--   → raw(aca_classes.season) 이 NULL 이면 기존 crm 값 유지
--   → raw 에 값이 들어오면 그 값으로 갱신
-- 다른 컬럼은 0058 정의 그대로 유지.

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
  WITH active_set AS (
    SELECT DISTINCT e.student_id
    FROM public.aca_enrollments e
    LEFT JOIN public.aca_classes c ON c.aca_class_id = e.aca_class_id
    WHERE (e.end_date IS NULL OR e.end_date >= CURRENT_DATE)
      AND (c.subject IS DISTINCT FROM '설명회')
  ),
  any_enrollment_set AS (
    SELECT DISTINCT e.student_id
    FROM public.aca_enrollments e
    LEFT JOIN public.aca_classes c ON c.aca_class_id = e.aca_class_id
    WHERE c.subject IS DISTINCT FROM '설명회'
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

  -- crm_classes UPSERT — season COALESCE 보존.
  -- INSERT 측은 raw 전체(SELECT *) 를 그대로 받으므로 새로 추가된 season 컬럼도
  -- raw 값 그대로 적재된다 (초기엔 NULL). UPDATE 측에서 EXCLUDED.season 이 NULL 이면
  -- 기존 crm 값을 유지 (운영 수동 입력 보존).
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
      -- 운영팀 수동 입력 보존: raw 가 NULL 이면 기존 값 유지, 값 있으면 갱신.
      season             = COALESCE(EXCLUDED.season, public.crm_classes.season),
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
  '0070 — crm_classes.season COALESCE 보존 추가 (운영 수동 입력이 다음 ETL 에 덮어쓰이지 않음). 그 외 0058 정의 유지 (subject 8종/설명회 제외 status 룰).';

COMMIT;
