-- ============================================================
-- 0089_search_students_phone_normalize.sql
-- search_students_by_region RPC 전화번호 검색 정규화.
-- ------------------------------------------------------------
-- 문제:
--   parent_phone 은 DB 에 하이픈 없는 숫자(01074667133)로 저장되는데,
--   기존 RPC 는 검색어를 그대로 '%검색어%' 로 만들어 ILIKE 했다. 그래서
--   '010-7466-7133' 처럼 하이픈을 넣어 검색하면 매칭되지 않았다.
--   (학생 명단 region 필터가 활성일 때만 이 RPC 경로를 탄다.)
--
-- 해결:
--   검색어가 전화번호 형태(숫자+구분자만)면 숫자만 뽑아(v_digits) 매칭.
--   '3학년'처럼 한글이 섞이면 전화번호 검색이 아니므로 기존 v_like 유지 —
--   숫자 부분일치 노이즈 방지. TS 경로(list-students.ts buildStudentSearchOr)
--   와 동일한 판정.
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
  v_digits text;  -- 전화번호 형태면 숫자만, 아니면 NULL
BEGIN
  -- 검색어는 ilike 패턴으로 변환.
  IF p_search IS NOT NULL AND length(trim(p_search)) > 0 THEN
    v_like := '%' || p_search || '%';
    -- 숫자·공백·하이픈·괄호·+ 외 문자가 없고 숫자가 있으면 전화번호 검색.
    IF p_search !~ '[^0-9[:space:]()+-]' THEN
      v_digits := regexp_replace(p_search, '\D', '', 'g');
      IF length(v_digits) = 0 THEN
        v_digits := NULL;
      END IF;
    END IF;
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
           OR (CASE WHEN v_digits IS NOT NULL
                    THEN s.parent_phone ILIKE '%' || v_digits || '%'
                    ELSE s.parent_phone ILIKE v_like END))
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
  '학생 명단 region 필터 전용 SECURITY INVOKER RPC. crm_students + crm_school_regions LEFT JOIN 직접 — PostgREST URL 폭주 회피 + view 풀집계 statement_timeout 회피. 전화번호 검색은 숫자 정규화 매칭(0089). 0067.';

COMMIT;
