-- ============================================================
-- 0100_search_students_by_region_class_code.sql
-- search_students_by_region RPC 에 강좌 코드 필터(p_class_marks/p_class_kinds) 추가.
-- ------------------------------------------------------------
-- 배경:
--   Aca2000 강좌명은 '(종)' 접두를 떼면 모두 [연도2자][#|@][R|S][N|Y|D...] 코드로
--   시작한다 (예: 26#SN, 25@RN, 26#RY). 운영진이 학생 명단을 이 코드 축으로 거르고
--   싶어함 (대표·구진규팀장 2026-06-30):
--     - 두 번째 기호 # / @  (구분)
--     - 세 번째 글자 R / S  (R≈정규 / S≈특강)
--   세 번째 이후(N/Y/D)는 이번 범위에서 제외.
--
-- 해결:
--   과목(0098)과 동일하게 이 RPC(crm_students 베이스 + EXISTS enrollments JOIN classes)
--   에 강좌명 접두 코드 조건을 추가한다. view 집계 컬럼이 아니라 students 베이스라 빠르다.
--   호출부(list-students.fetchViaView)는 region/subjects 와 동일하게, class 코드 필터가
--   있으면 이 RPC 로 id+total 만 받아 student_profiles 뷰는 그 50행만 materialize.
--
--   코드 파싱(접두 '(종)'/'종)' 무시):
--     mark = substring(name from '^[^0-9]*[0-9]{2}([#@])')          -- '#' 또는 '@'
--     kind = upper(substring(name from '^[^0-9]*[0-9]{2}[#@]([A-Za-z])'))  -- 'R'/'S' (없으면 NULL)
--   '@1'·'@2' 처럼 # @ 뒤가 숫자면 kind 는 NULL → R/S 필터에 안 걸린다(의도).
--   매칭 강좌 시맨틱 = 현재 진행 중(end_date NULL/미래) — 과목 필터와 동일.
--   mark/kind 는 같은 강좌에서 함께 만족해야 한다(단일 EXISTS).
--
-- 시그니처 변경:
--   p_class_marks text[], p_class_kinds text[] 추가. 0099 의 13-param 함수를 먼저
--   DROP 후 재생성(named-arg overload 모호성 방지). 신규 인자 미전달 기존 호출은
--   DEFAULT NULL → 강좌 코드 조건 무효 = 기존 동작 유지.
--
-- 롤백: 본 파일 DROP 후 0099 의 CREATE 재실행.
-- ============================================================

BEGIN;

-- 기존 13-param 시그니처 제거 (named-arg 호출 모호성 방지).
DROP FUNCTION IF EXISTS public.search_students_by_region(
  text[], text, text, text[], text[], text[], text[], boolean, text, int, int, text[], boolean
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
  p_subjects_match_all boolean DEFAULT false,
  p_class_marks text[] DEFAULT NULL,
  p_class_kinds text[] DEFAULT NULL
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
      -- 강좌 코드 (있을 때만). 강좌명 접두 [연도][#|@][R|S] 파싱 — 현재 진행 중 강좌.
      -- mark/kind 는 같은 강좌에서 함께 만족(단일 EXISTS). 둘 다 비면 조건 무효.
      AND ((p_class_marks IS NULL OR array_length(p_class_marks, 1) IS NULL)
           AND (p_class_kinds IS NULL OR array_length(p_class_kinds, 1) IS NULL)
           OR EXISTS (
             SELECT 1
               FROM public.crm_enrollments e
               JOIN public.crm_classes c ON c.aca_class_id = e.aca_class_id
              WHERE e.student_id = s.id
                AND (e.end_date IS NULL OR e.end_date >= CURRENT_DATE)
                AND (p_class_marks IS NULL OR array_length(p_class_marks, 1) IS NULL
                     OR substring(c.name from '^[^0-9]*[0-9]{2}([#@])') = ANY(p_class_marks))
                AND (p_class_kinds IS NULL OR array_length(p_class_kinds, 1) IS NULL
                     OR upper(substring(c.name from '^[^0-9]*[0-9]{2}[#@]([A-Za-z])')) = ANY(p_class_kinds))
           ))
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
  '학생 명단 region/subjects/강좌코드 필터 전용 SECURITY INVOKER RPC. crm_students 베이스 + region(school_regions LEFT JOIN) + subjects/강좌코드(현재 진행 중 enrollments JOIN classes EXISTS) — view 집계 컬럼 overlaps 의 풀집계 statement_timeout 회피. p_subjects_match_all=true 면 과목 전부 수강(교집합). p_class_marks(#/@)·p_class_kinds(R/S) 는 강좌명 접두 코드 파싱. id+total_count 반환. 0067/0098/0099/0100.';

COMMIT;

-- ============================================================
-- ROLLBACK (수동):
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.search_students_by_region(
--   text[], text, text, text[], text[], text[], text[], boolean, text, int, int, text[], boolean, text[], text[]
-- );
-- 그리고 0099 의 CREATE FUNCTION 블록 재실행.
-- COMMIT;
-- ============================================================
