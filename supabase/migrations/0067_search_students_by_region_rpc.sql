-- ============================================================
-- 0067_search_students_by_region_rpc.sql
-- region 필터 시 PostgREST URL 폭주 회피용 RPC 함수.
-- ------------------------------------------------------------
-- 문제:
--   학생 명단의 region 필터는 학교명 IN/NOT IN 으로 변환되는데, 학원생 학교
--   매핑이 수백~수천 단위라 PostgREST URL 한계(~8KB) 초과 → 500.
--   대안으로 student_profiles 뷰의 region 컬럼 IN 매칭을 썼더니 view 풀 집계
--   GROUP BY 가 statement_timeout 초과.
--
-- 해결:
--   crm_students + crm_school_regions LEFT JOIN 를 SQL 단에서 직접 처리하는
--   SECURITY DEFINER RPC. PostgREST URL 은 region 칩(최대 7종) 만 인자로 보내
--   짧고, students 의 0046 인덱스를 그대로 활용해 빠르다.
--
-- 시그니처:
--   search_students_by_region(p_regions, p_branch, p_search, p_grades,
--     p_school_levels, p_statuses, p_schools, p_include_hidden, p_sort,
--     p_offset, p_limit) RETURNS TABLE (id uuid, total_count bigint)
--
--   - 첫 행 부터 페이지(p_limit) 개 학생의 id 를 반환.
--   - 모든 행에 total_count 동일 값(window count) 으로 채워, 호출부가 count
--     별도 쿼리 없이 같은 결과셋에서 추출 가능.
--
-- 호출부:
--   list-students.ts 의 fetchViaView 를 본 RPC 호출로 대체.
--   id 목록을 받은 후 student_profiles 뷰에서 in('id', ids) 로 작은 set 만
--   materialize → 풀집계 비용 회피.
--
-- 보안:
--   SECURITY INVOKER — 호출자 권한 사용. RLS 가 자동 적용.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.search_students_by_region(
  p_regions text[],
  p_branch text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_grades text[] DEFAULT NULL,
  p_school_levels text[] DEFAULT NULL,
  p_statuses text[] DEFAULT NULL,
  p_schools text[] DEFAULT NULL,
  p_include_hidden boolean DEFAULT false,
  p_sort text DEFAULT 'registered_desc',
  p_offset int DEFAULT 0,
  p_limit int DEFAULT 50
)
RETURNS TABLE(id uuid, total_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_like text;
BEGIN
  -- 검색어는 ilike 패턴으로 변환.
  IF p_search IS NOT NULL AND length(trim(p_search)) > 0 THEN
    v_like := '%' || p_search || '%';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT s.id, s.registered_at, s.name
    FROM public.crm_students s
    LEFT JOIN public.crm_school_regions sr ON sr.school = s.school
    WHERE COALESCE(sr.region, '기타') = ANY(p_regions)
      AND s.status <> '탈퇴'
      AND (p_branch IS NULL OR p_branch = '전체' OR s.branch = p_branch)
      AND (p_grades IS NULL OR array_length(p_grades, 1) IS NULL
           OR s.grade::text = ANY(p_grades))
      AND (p_school_levels IS NULL OR array_length(p_school_levels, 1) IS NULL
           OR s.school_level::text = ANY(p_school_levels))
      AND (p_statuses IS NULL OR array_length(p_statuses, 1) IS NULL
           OR s.status::text = ANY(p_statuses))
      AND (p_schools IS NULL OR array_length(p_schools, 1) IS NULL
           OR s.school = ANY(p_schools))
      AND (v_like IS NULL
           OR s.name ILIKE v_like
           OR s.school ILIKE v_like
           OR s.parent_phone ILIKE v_like)
      AND (p_include_hidden
           OR p_grades IS NOT NULL AND array_length(p_grades, 1) > 0
           OR s.grade::text NOT IN ('졸업', '미정'))
  ),
  counted AS (
    SELECT b.id, b.registered_at, b.name,
           COUNT(*) OVER () AS total_count
    FROM base b
  )
  SELECT c.id, c.total_count
  FROM counted c
  ORDER BY
    CASE WHEN p_sort = 'registered_asc'  THEN c.registered_at END ASC NULLS LAST,
    CASE WHEN p_sort = 'name_asc'        THEN c.name END ASC,
    CASE WHEN p_sort = 'name_desc'       THEN c.name END DESC,
    CASE WHEN p_sort NOT IN ('registered_asc','name_asc','name_desc')
         THEN c.registered_at END DESC NULLS LAST
  OFFSET p_offset
  LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION public.search_students_by_region IS
  '학생 명단 region 필터 전용 SECURITY INVOKER RPC. crm_students + crm_school_regions LEFT JOIN 직접 — PostgREST URL 폭주 회피 + view 풀집계 statement_timeout 회피. 0067.';

COMMIT;
