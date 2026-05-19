-- 0051_crm_curated_layer.sql
-- Dual-layer 도입 — aca_*(raw) → crm_*(curated) 분리.
--
-- 사용자 결정 (2026-05-19):
--   1. ETL 마다 aca_*(raw) 에 MSSQL 그대로 덮어쓰기
--   2. 그 후 정제 함수가 aca_* 를 crm_* 로 정제 (status 자동, 학교 백필 등)
--   3. 운영 페이지(/students 등)는 crm_* 만 봄
--
-- 새 테이블 (LIKE INCLUDING ALL 로 aca_* 와 동일 schema):
--   crm_students      ← aca_students  (정제: status 자동, school 추론)
--   crm_classes       ← aca_classes   (1:1)
--   crm_enrollments   ← aca_enrollments (1:1)
--   crm_attendances   ← aca_attendances (1:1)
--
-- 정제 함수:
--   apply_aca_to_crm() — ETL 직후 호출. aca_* 4개 → crm_* 4개 일괄 정제 UPSERT.
--
-- view / RPC 재정의:
--   student_profiles               (aca_* → crm_*)
--   list_unmapped_school_counts    (aca_students → crm_students)
--   count_unmapped_schools
--   list_school_regions_with_students
--
-- 기존 crm_*(groups/templates/campaigns/messages/users_profile/school_regions/
-- unsubscribes) 은 그대로 — 의미적으로 CRM 자체 데이터.

BEGIN;

SET LOCAL statement_timeout = '5min';

-- ── 1) crm_* 4 테이블 생성 (schema 복사) ─────────────────
-- LIKE INCLUDING ALL — 컬럼·DEFAULT·NOT NULL·CHECK·PK·인덱스·identity 까지 복사.
-- FK 는 명시적 ADD CONSTRAINT 로 별도 (LIKE 는 FK 안 따라감).

CREATE TABLE public.crm_students (LIKE public.aca_students INCLUDING ALL);
CREATE TABLE public.crm_classes (LIKE public.aca_classes INCLUDING ALL);
CREATE TABLE public.crm_enrollments (LIKE public.aca_enrollments INCLUDING ALL);
CREATE TABLE public.crm_attendances (LIKE public.aca_attendances INCLUDING ALL);

-- ── 2) FK 추가 (crm_* 내부 무결성) ───────────────────────
ALTER TABLE public.crm_enrollments
  ADD CONSTRAINT crm_enrollments_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.crm_students(id) ON DELETE CASCADE;

ALTER TABLE public.crm_attendances
  ADD CONSTRAINT crm_attendances_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES public.crm_students(id) ON DELETE CASCADE;

ALTER TABLE public.crm_attendances
  ADD CONSTRAINT crm_attendances_enrollment_id_fkey
  FOREIGN KEY (enrollment_id) REFERENCES public.crm_enrollments(id) ON DELETE SET NULL;

-- ── 3) RLS 정책 — aca_* 와 동일한 분원 격리 ─────────────
ALTER TABLE public.crm_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_attendances ENABLE ROW LEVEL SECURITY;

-- master/admin/manager/viewer: 자기 분원 읽기.
CREATE POLICY crm_students_read_by_branch ON public.crm_students
  FOR SELECT USING (public.can_read_branch(branch));

CREATE POLICY crm_classes_read_by_branch ON public.crm_classes
  FOR SELECT USING (public.can_read_branch(branch));

-- enrollments / attendances: student 의 branch 로 격리.
CREATE POLICY crm_enrollments_read_by_branch ON public.crm_enrollments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.crm_students s
      WHERE s.id = crm_enrollments.student_id
        AND public.can_read_branch(s.branch)
    )
  );

CREATE POLICY crm_attendances_read_by_branch ON public.crm_attendances
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.crm_students s
      WHERE s.id = crm_attendances.student_id
        AND public.can_read_branch(s.branch)
    )
  );

-- 쓰기는 master/admin 만 + 분원 일치. (실시간 운영 변경용. ETL 정제는 SECURITY
-- DEFINER 함수가 우회.)
CREATE POLICY crm_students_write_by_branch ON public.crm_students
  FOR ALL USING (public.can_write_branch(branch))
  WITH CHECK (public.can_write_branch(branch));

CREATE POLICY crm_classes_write_by_branch ON public.crm_classes
  FOR ALL USING (public.can_write_branch(branch))
  WITH CHECK (public.can_write_branch(branch));

-- ── 4) student_profiles view 재정의 (crm_* 참조) ────────
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
FROM public.crm_students s
LEFT JOIN public.crm_enrollments e    ON e.student_id = s.id
LEFT JOIN public.crm_attendances a    ON a.student_id = s.id
LEFT JOIN public.crm_school_regions sr ON sr.school = s.school
GROUP BY s.id, sr.region;

COMMENT ON VIEW public.student_profiles IS
  '학생 프로필 (crm_* curated layer 기반). 0051 dual-layer 적용.';

-- ── 5) RPC 함수 재정의 (crm_students/crm_school_regions 참조) ───
CREATE OR REPLACE FUNCTION public.list_unmapped_school_counts(p_limit int DEFAULT 50)
RETURNS TABLE(school text, student_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    s.school::text AS school,
    COUNT(*)::bigint AS student_count
  FROM public.crm_students s
  LEFT JOIN public.crm_school_regions sr ON sr.school = s.school
  WHERE s.school IS NOT NULL
    AND s.status = '재원생'
    AND sr.school IS NULL
  GROUP BY s.school
  ORDER BY student_count DESC, s.school
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION public.count_unmapped_schools()
RETURNS bigint
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COUNT(DISTINCT s.school)::bigint
  FROM public.crm_students s
  LEFT JOIN public.crm_school_regions sr ON sr.school = s.school
  WHERE s.school IS NOT NULL
    AND s.status = '재원생'
    AND sr.school IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.list_school_regions_with_students(
  p_search TEXT DEFAULT NULL,
  p_region TEXT DEFAULT NULL
)
RETURNS TABLE(
  school     TEXT,
  region     TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    sr.school::TEXT,
    sr.region::TEXT,
    sr.created_at,
    sr.updated_at
  FROM public.crm_school_regions sr
  WHERE EXISTS (
    SELECT 1
    FROM public.crm_students s
    WHERE s.school = sr.school
  )
  AND (p_search IS NULL OR sr.school ILIKE '%' || p_search || '%')
  AND (p_region IS NULL OR sr.region = p_region)
  ORDER BY sr.region, sr.school;
$$;

-- ── 6) 정제 함수 apply_aca_to_crm() ─────────────────────
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
  -- ── crm_students 갱신 (정제 룰 적용) ──
  -- status 정제: 진행 중 enrollment 있으면 '재원생', 아니면 '수강이력자',
  --              단 aca 의 status='탈퇴' 는 보존.
  -- school 정제: aca.school NULL 이고 학생 강좌 반명에 매핑 학교명이 있으면
  --              가장 빈도 높은 학교로 채움.
  WITH active_set AS (
    SELECT DISTINCT student_id
    FROM public.aca_enrollments
    WHERE end_date IS NULL OR end_date >= CURRENT_DATE
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
      -- 학교 정제: aca.school 우선, 비어있으면 추론 결과.
      COALESCE(a.school, bs.school) AS school,
      a.grade, a.grade_raw, a.school_level,
      -- status 정제.
      CASE
        WHEN a.status = '탈퇴' THEN '탈퇴'
        WHEN a.id IN (SELECT student_id FROM active_set) THEN '재원생'
        ELSE '수강이력자'
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

  -- ── crm_classes 갱신 (1:1) ──
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

  -- ── crm_enrollments 갱신 (1:1) ──
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

  -- ── crm_attendances 갱신 (1:1) ──
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
  'ETL 직후 호출 — aca_*(raw) → crm_*(curated) 일괄 정제 UPSERT. status/school 자동 룰 + 나머지 1:1.';

GRANT EXECUTE ON FUNCTION public.apply_aca_to_crm() TO authenticated;

COMMIT;
