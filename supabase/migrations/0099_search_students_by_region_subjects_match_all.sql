-- ============================================================
-- 0099_search_students_by_region_subjects_match_all.sql
-- search_students_by_region RPC 에 과목 매칭 모드(p_subjects_match_all) 추가.
-- ------------------------------------------------------------
-- 배경:
--   0098 의 과목 필터는 EXISTS(...) — '선택 과목 중 하나라도 수강'(합집합/OR).
--   탐색기(/explorer)에서 "국어 AND 수학 둘 다 듣는 학생" 같은 교집합 집계 요구
--   (대표·구진규팀장 문의 2026-06-30). 합집합/교집합을 호출부가 선택할 수 있어야 함.
--
-- 해결:
--   p_subjects_match_all boolean DEFAULT false 추가.
--     false(기본) → 기존 EXISTS (선택 과목 중 하나라도 — 합집합).
--     true        → 선택 과목을 '전부' 현재 수강 중인 학생만 (교집합).
--   교집합은 학생이 수강 중인 '선택 과목들'의 DISTINCT 개수가 선택 과목 수와
--   같은지로 판정한다. UI 가 과목 칩을 중복 없이 토글하므로 p_subjects 무중복 가정.
--   과목 시맨틱은 0098 과 동일 — 현재 진행 중 강좌(end_date NULL/미래)의 classes.subject.
--
-- 시그니처 변경:
--   파라미터 추가는 overload 를 만들어 named-arg 호출이 모호해질 수 있어 기존 12-param
--   함수를 먼저 DROP 후 재생성. 호출부는 named 파라미터라 위치 무관, 신규 인자 미전달
--   호출(기존 코드)은 DEFAULT false 로 기존 합집합 동작 유지.
--
-- 롤백: 본 파일 DROP 후 0098 의 CREATE 재실행.
-- ============================================================

BEGIN;

-- 기존 12-param 시그니처 제거 (named-arg 호출 모호성 방지).
DROP FUNCTION IF EXISTS public.search_students_by_region(
  text[], text, text, text[], text[], text[], text[], boolean, text, int, int, text[]
);

CREATE FUNCTION public.search_students_by_region(
  p_regions text[] DEFAULT NULL,
  p_branch text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_grades text[] DEFAULT NULL,
  p_school_levels text[] DEFAULT NULL,
  p_statuses text[] DEFAULT NULL,
  p_schools text[] DEFAULT NULL,
  p_include_hidden boolean DEFAULT false,
  p_sort text DEFAULT 'registered_desc',
  p_offset int DEFAULT 0,
  p_limit int DEFAULT 50,
  p_subjects text[] DEFAULT NULL,
  p_subjects_match_all boolean DEFAULT false
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
    WHERE s.status <> '탈퇴'
      -- region 필터 (있을 때만). 미매핑 학교는 '기타'.
      AND (p_regions IS NULL OR array_length(p_regions, 1) IS NULL
           OR COALESCE(sr.region, '기타') = ANY(p_regions))
      AND (p_branch IS NULL OR p_branch = '전체' OR s.branch = p_branch)
      AND (p_grades IS NULL OR array_length(p_grades, 1) IS NULL
           OR s.grade::text = ANY(p_grades))
      AND (p_school_levels IS NULL OR array_length(p_school_levels, 1) IS NULL
           OR s.school_level::text = ANY(p_school_levels))
      AND (p_statuses IS NULL OR array_length(p_statuses, 1) IS NULL
           OR s.status::text = ANY(p_statuses))
      AND (p_schools IS NULL OR array_length(p_schools, 1) IS NULL
           OR s.school = ANY(p_schools))
      -- 수강 과목 (있을 때만). 현재 진행 중 강좌(end_date NULL/미래)의 classes.subject.
      -- enrollments.subject 는 ETL 상 항상 NULL 이라 classes 경유 (student_profiles 0063 동일).
      -- match_all=false → 하나라도(합집합), true → 전부(교집합).
      AND (p_subjects IS NULL OR array_length(p_subjects, 1) IS NULL
           OR (CASE WHEN p_subjects_match_all THEN
                 (SELECT COUNT(DISTINCT c.subject)
                    FROM public.crm_enrollments e
                    JOIN public.crm_classes c ON c.aca_class_id = e.aca_class_id
                   WHERE e.student_id = s.id
                     AND c.subject = ANY(p_subjects)
                     AND (e.end_date IS NULL OR e.end_date >= CURRENT_DATE)
                 ) = array_length(p_subjects, 1)
               ELSE
                 EXISTS (
                   SELECT 1
                     FROM public.crm_enrollments e
                     JOIN public.crm_classes c ON c.aca_class_id = e.aca_class_id
                    WHERE e.student_id = s.id
                      AND c.subject = ANY(p_subjects)
                      AND (e.end_date IS NULL OR e.end_date >= CURRENT_DATE)
                 )
               END))
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
  '학생 명단 region/subjects 필터 전용 SECURITY INVOKER RPC. crm_students 베이스 + region(school_regions LEFT JOIN) + subjects(현재 진행 중 enrollments JOIN classes EXISTS) — view 집계 컬럼 overlaps 의 풀집계 statement_timeout 회피. p_subjects_match_all=true 면 선택 과목을 전부 수강(교집합), false 면 하나라도(합집합). id+total_count 반환, 정렬은 registered/name (view 정렬 키는 registered_desc 폴백). 전화번호 검색 숫자 정규화(0089). 0067/0098/0099.';

COMMIT;

-- ============================================================
-- ROLLBACK (수동):
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.search_students_by_region(
--   text[], text, text, text[], text[], text[], text[], boolean, text, int, int, text[], boolean
-- );
-- 그리고 0098 의 CREATE FUNCTION 블록 재실행.
-- COMMIT;
-- ============================================================
