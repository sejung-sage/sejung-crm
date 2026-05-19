-- 0049_table_prefix_aca_crm.sql
-- 테이블 이름 prefix 분리 — 아카(Aca2000) 출처 vs CRM 자체 데이터 명확화.
--
-- 사용자 요청 (2026-05-19): "아카에서 갖고온 테이블, CRM에서 사용하는 테이블
-- 이렇게 2개를 앞에 aca_ crm_ 이런식으로 구분"
--
-- 매핑:
--   aca_*  (Aca2000 ETL 출처, students-> enrollments -> classes -> attendances 의존성)
--     students       → aca_students
--     enrollments    → aca_enrollments
--     attendances    → aca_attendances
--     classes        → aca_classes
--
--   crm_*  (CRM 자체)
--     users_profile  → crm_users_profile
--     school_regions → crm_school_regions
--     groups         → crm_groups
--     templates      → crm_templates
--     campaigns      → crm_campaigns
--     messages       → crm_messages
--     unsubscribes   → crm_unsubscribes
--
--   view (변경 없음 — join 결과라 prefix 무관)
--     student_profiles
--
-- 순서 (의존성 안전):
--   1) view DROP (테이블 참조)
--   2) ALTER TABLE RENAME 11개 (인덱스/제약/FK/policy 자동 따라감)
--   3) view 재생성 (새 테이블 이름으로)
--   4) 함수 재정의 — 모든 함수 본문 SQL 의 테이블 이름 갱신
--      · RLS helpers: current_user_role, current_user_branch, is_master,
--        can_write_branch, can_send_branch, can_read_branch
--      · ETL helpers: normalize_student_grade, derive_school_level (테이블
--        참조 없음 — 변경 불필요)
--      · 캠페인 sweep: find_stalled_campaigns, sweep_stalled_campaigns
--      · 학교/지역 RPC: list_unmapped_school_counts, count_unmapped_schools,
--        list_school_regions_with_students
--
-- pg_cron job 은 함수 이름이 그대로라 자동 따라감 — 별도 작업 불필요.
--
-- 안전:
--   - ALTER TABLE RENAME 시 PK·FK·인덱스·CHECK·policy 모두 새 이름으로 자동 매핑.
--   - 함수 OID 바인딩이 PostgreSQL 버전에 따라 다르므로 모든 함수를 명시적으로
--     CREATE OR REPLACE 로 본문 SQL 갱신 — 안전한 명시 변경.
--   - 전체 트랜잭션 — 한 곳이라도 실패하면 전체 rollback.
--
-- ROLLBACK:
--   복잡함. 별도 PR 로 reverse 마이그 작성 필요. 운영 적용 전 supabase
--   snapshot 권장.

BEGIN;

SET LOCAL statement_timeout = '5min';

-- ── 1) view DROP ─────────────────────────────────────────
DROP VIEW IF EXISTS public.student_profiles;

-- ── 2) ALTER TABLE RENAME ────────────────────────────────
ALTER TABLE public.students       RENAME TO aca_students;
ALTER TABLE public.enrollments    RENAME TO aca_enrollments;
ALTER TABLE public.attendances    RENAME TO aca_attendances;
ALTER TABLE public.classes        RENAME TO aca_classes;

ALTER TABLE public.users_profile  RENAME TO crm_users_profile;
ALTER TABLE public.school_regions RENAME TO crm_school_regions;
ALTER TABLE public.groups         RENAME TO crm_groups;
ALTER TABLE public.templates      RENAME TO crm_templates;
ALTER TABLE public.campaigns      RENAME TO crm_campaigns;
ALTER TABLE public.messages       RENAME TO crm_messages;
ALTER TABLE public.unsubscribes   RENAME TO crm_unsubscribes;

-- ── 3) student_profiles view 재생성 (0030 정의 + track 제거 0044) ────
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
FROM public.aca_students s
LEFT JOIN public.aca_enrollments e    ON e.student_id = s.id
LEFT JOIN public.aca_attendances a    ON a.student_id = s.id
LEFT JOIN public.crm_school_regions sr ON sr.school = s.school
GROUP BY s.id, sr.region;

COMMENT ON VIEW public.student_profiles IS
  '학생 프로필 (aca_students + aca_enrollments + aca_attendances 집계 + crm_school_regions 지역 매핑). 0049 에서 테이블 prefix 반영.';

-- ── 4) 함수 재정의 ────────────────────────────────────────

-- 4-1) RLS helpers — users_profile → crm_users_profile
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT role FROM public.crm_users_profile WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_user_branch()
RETURNS TEXT
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT branch FROM public.crm_users_profile WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_master()
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT role = 'master' FROM public.crm_users_profile WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.can_write_branch(target_branch TEXT)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.crm_users_profile up
    WHERE up.user_id = auth.uid()
      AND up.active = TRUE
      AND (
        up.role = 'master'
        OR (up.role = 'admin' AND up.branch = target_branch)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_send_branch(target_branch TEXT)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.crm_users_profile up
    WHERE up.user_id = auth.uid()
      AND up.active = TRUE
      AND (
        up.role = 'master'
        OR (up.role IN ('admin', 'manager') AND up.branch = target_branch)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_read_branch(target_branch TEXT)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.crm_users_profile up
    WHERE up.user_id = auth.uid()
      AND up.active = TRUE
      AND (up.role = 'master' OR up.branch = target_branch)
  );
$$;

-- 4-2) 캠페인 sweep — campaigns/messages → crm_*
CREATE OR REPLACE FUNCTION public.find_stalled_campaigns(
  p_stall_minutes int DEFAULT 3
)
RETURNS TABLE (campaign_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id AS campaign_id
    FROM public.crm_campaigns c
   WHERE c.status = '발송중'
     AND EXISTS (
       SELECT 1
         FROM public.crm_messages m
        WHERE m.campaign_id = c.id
          AND m.status = '대기'
     )
     AND COALESCE(
           (SELECT MAX(m.sent_at)
              FROM public.crm_messages m
             WHERE m.campaign_id = c.id),
           c.created_at
         ) < (now() - make_interval(mins => p_stall_minutes));
$$;

-- sweep_stalled_campaigns 는 find_stalled_campaigns 만 호출 — 직접 테이블 참조 X.
-- 본문 SQL 의 테이블 참조 없어 재정의 불필요. (Vault 와 HTTP 호출만 수행.)

-- 4-3) 학교/지역 RPC — students/school_regions → aca_students/crm_school_regions
CREATE OR REPLACE FUNCTION public.list_unmapped_school_counts(p_limit int DEFAULT 50)
RETURNS TABLE(school text, student_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    s.school::text AS school,
    COUNT(*)::bigint AS student_count
  FROM public.aca_students s
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
  FROM public.aca_students s
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
    FROM public.aca_students s
    WHERE s.school = sr.school
  )
  AND (p_search IS NULL OR sr.school ILIKE '%' || p_search || '%')
  AND (p_region IS NULL OR sr.region = p_region)
  ORDER BY sr.region, sr.school;
$$;

-- normalize_student_grade / derive_school_level 은 파라미터만 받는 순수 함수라
-- 테이블 참조 없음 — 재정의 불필요.

COMMIT;
