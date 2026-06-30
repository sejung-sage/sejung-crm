-- ============================================================
-- 0098_search_students_by_region_subjects.sql
-- search_students_by_region RPC 에 과목(p_subjects) 필터 추가 + region 선택화.
-- ------------------------------------------------------------
-- 배경:
--   학생 명단의 '수강 과목' 필터를 student_profiles.subjects (view 집계 text[]) 에
--   PostgREST `.overlaps` 로 걸면, 그 컬럼이 GROUP BY 집계 결과라 WHERE 푸시다운이
--   안 된다. 전체 분원에선 60k 학생 view 풀집계(과목당 38~55초) → statement_timeout
--   → 학생 명단 오류. (분원 좁힘이 있으면 빨라서 안 드러났음.)
--
-- 해결:
--   region 필터가 이미 쓰는 이 RPC(crm_students 베이스 + id/total_count 반환 + 정렬)에
--   과목 조건을 추가한다. 과목은 EXISTS(enrollments JOIN classes)로 매칭 — view
--   풀집계 대신 students 베이스라 빠르다. 호출부(list-students.fetchViaView)는 region
--   또는 subjects 가 있으면 이 RPC 로 id+total 만 받아, student_profiles 뷰는 그 50행만
--   materialize 한다(풀집계 회피).
--
--   과목 시맨틱 = '현재 진행 중 강좌의 과목' — student_profiles.subjects (0063) 와 동일:
--     end_date IS NULL OR end_date >= CURRENT_DATE. UI 칩 라벨 '수강 과목'(=수강중) 의도와
--     일치. (그룹 빌더 search_recipients 는 '과거 포함' 이라 의도가 다름 — 의도적 분리.)
--
-- 시그니처 변경:
--   p_subjects text[] 추가 + p_regions 를 DEFAULT NULL 로(과목만 쓰는 호출 허용).
--   파라미터 추가는 overload 를 만들어 PostgREST named-arg 호출이 모호해질 수 있어
--   기존 함수를 먼저 DROP 후 재생성한다. 호출부는 named 파라미터라 위치 무관.
--
-- 롤백: 본 파일 DROP 후 0089 의 CREATE 재실행.
-- ============================================================

BEGIN;

-- 기존 시그니처 제거 (named-arg 호출 모호성 방지).
DROP FUNCTION IF EXISTS public.search_students_by_region(
  text[], text, text, text[], text[], text[], text[], boolean, text, int, int
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
  p_subjects text[] DEFAULT NULL
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
      AND (p_subjects IS NULL OR array_length(p_subjects, 1) IS NULL
           OR EXISTS (
             SELECT 1
               FROM public.crm_enrollments e
               JOIN public.crm_classes c ON c.aca_class_id = e.aca_class_id
              WHERE e.student_id = s.id
                AND c.subject = ANY(p_subjects)
                AND (e.end_date IS NULL OR e.end_date >= CURRENT_DATE)
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
  '학생 명단 region/subjects 필터 전용 SECURITY INVOKER RPC. crm_students 베이스 + region(school_regions LEFT JOIN) + subjects(현재 진행 중 enrollments JOIN classes EXISTS) — view 집계 컬럼 overlaps 의 풀집계 statement_timeout 회피. id+total_count 반환, 정렬은 registered/name (view 정렬 키는 registered_desc 폴백). 전화번호 검색 숫자 정규화(0089). 0067/0098.';

COMMIT;

-- ============================================================
-- ROLLBACK (수동):
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.search_students_by_region(
--   text[], text, text, text[], text[], text[], text[], boolean, text, int, int, text[]
-- );
-- 그리고 0089 의 CREATE OR REPLACE FUNCTION 블록 재실행.
-- COMMIT;
-- ============================================================
