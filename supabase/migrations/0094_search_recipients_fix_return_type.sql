-- ============================================================
-- 0094_search_recipients_fix_return_type.sql
-- 0093 search_recipients 반환 타입 정정.
-- ------------------------------------------------------------
-- 0093 은 RETURNS TABLE 에 registered_at 을 timestamptz 로 선언했으나, 실제
-- crm_students.registered_at 컬럼은 date 라 호출 시
--   "structure of query does not match function result type
--    (Returned type date does not match expected type timestamp with time zone)"
-- 42804 에러가 났다.
--
-- registered_at 값은 호출자(preview-recipients / load-all-group-recipients)가 쓰지
-- 않고 정렬(registered_at DESC NULLS LAST)에만 필요하다. 따라서 반환 컬럼에서 제거하고
-- 내부 ORDER BY 에서만 사용하도록 고친다(반환 타입 변경이라 DROP 후 재생성).
--
-- 보안/시맨틱은 0093 과 동일. 자세한 필터 설명은 0093 주석 참조.
-- ============================================================

BEGIN;

-- 반환 시그니처(OUT 컬럼)가 바뀌므로 CREATE OR REPLACE 불가 → 먼저 DROP.
DROP FUNCTION IF EXISTS public.search_recipients(
  text, text[], text[], text[], text[], text[], boolean, boolean,
  uuid[], uuid[], text[], uuid[], boolean, int, int
);

CREATE FUNCTION public.search_recipients(
  p_branch text,
  p_grades text[] DEFAULT NULL,
  p_schools text[] DEFAULT NULL,
  p_regions text[] DEFAULT NULL,
  p_subjects text[] DEFAULT NULL,
  p_statuses text[] DEFAULT NULL,
  p_mapped_school boolean DEFAULT false,
  p_unmapped_school boolean DEFAULT false,
  p_include_ids uuid[] DEFAULT NULL,
  p_exclude_ids uuid[] DEFAULT NULL,
  p_exclude_schools text[] DEFAULT NULL,
  p_exclude_class_ids uuid[] DEFAULT NULL,
  p_require_parent_phone boolean DEFAULT false,
  p_offset int DEFAULT 0,
  p_limit int DEFAULT 5
)
RETURNS TABLE(
  id uuid,
  name text,
  parent_phone text,
  phone text,
  status text,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_wanted_statuses text[];
  v_exclude_aca_class_ids text[];
  -- src/lib/schemas/common.ts 의 UNMAPPED_SCHOOL_PATTERNS 와 동일 — "학교 미등록" placeholder.
  v_unmapped text[] := ARRAY[
    '고','고고','고등학교','중','중중','중학교','초','초등','초등학교','대학교','재수'
  ];
BEGIN
  v_wanted_statuses := COALESCE(
    NULLIF(p_statuses, ARRAY[]::text[]),
    ARRAY['재원생', '수강이력자', '수강 x']
  );

  IF p_exclude_class_ids IS NOT NULL
     AND array_length(p_exclude_class_ids, 1) > 0 THEN
    SELECT array_agg(c.aca_class_id)
      INTO v_exclude_aca_class_ids
      FROM public.crm_classes c
     WHERE c.id = ANY(p_exclude_class_ids)
       AND c.aca_class_id IS NOT NULL;
  END IF;

  RETURN QUERY
  WITH matched AS (
    SELECT s.id, s.name, s.parent_phone, s.phone,
           s.status::text AS status, s.registered_at
    FROM public.crm_students s
    WHERE s.status <> '탈퇴'
      AND s.status::text = ANY(v_wanted_statuses)
      AND (p_branch IS NULL OR p_branch = '' OR p_branch = '전체'
           OR s.branch = p_branch)
      AND (p_include_ids IS NULL OR array_length(p_include_ids, 1) IS NULL
           OR s.id = ANY(p_include_ids))
      AND (p_grades IS NULL OR array_length(p_grades, 1) IS NULL
           OR s.grade::text = ANY(p_grades))
      AND (p_schools IS NULL OR array_length(p_schools, 1) IS NULL
           OR s.school = ANY(p_schools))
      AND (p_regions IS NULL OR array_length(p_regions, 1) IS NULL
           OR EXISTS (
             SELECT 1 FROM public.crm_school_regions sr
              WHERE sr.school = s.school AND sr.region = ANY(p_regions)
           ))
      AND (p_subjects IS NULL OR array_length(p_subjects, 1) IS NULL
           OR EXISTS (
             SELECT 1
               FROM public.crm_enrollments e
               JOIN public.crm_classes c ON c.aca_class_id = e.aca_class_id
              WHERE e.student_id = s.id
                AND c.subject = ANY(p_subjects)
           ))
      AND (NOT p_unmapped_school
           OR s.school IS NULL OR s.school = ANY(v_unmapped))
      AND (NOT p_mapped_school
           OR (s.school IS NOT NULL AND NOT (s.school = ANY(v_unmapped))))
      AND (p_exclude_ids IS NULL OR array_length(p_exclude_ids, 1) IS NULL
           OR NOT (s.id = ANY(p_exclude_ids)))
      AND (p_exclude_schools IS NULL OR array_length(p_exclude_schools, 1) IS NULL
           OR s.school IS NULL OR NOT (s.school = ANY(p_exclude_schools)))
      AND (v_exclude_aca_class_ids IS NULL
           OR array_length(v_exclude_aca_class_ids, 1) IS NULL
           OR NOT EXISTS (
             SELECT 1
               FROM public.crm_enrollments ex
              WHERE ex.student_id = s.id
                AND ex.aca_class_id = ANY(v_exclude_aca_class_ids)
           ))
      AND (NOT p_require_parent_phone OR s.parent_phone IS NOT NULL)
  ),
  counted AS (
    SELECT m.*, COUNT(*) OVER () AS total_count
    FROM matched m
  )
  SELECT c.id, c.name, c.parent_phone, c.phone, c.status, c.total_count
  FROM counted c
  ORDER BY c.registered_at DESC NULLS LAST, c.id
  OFFSET p_offset
  LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION public.search_recipients IS
  '일반 수신자 검색 RPC(0093/0094). subjects 유무 무관 모든 필터+ID 배열을 요청 본문으로
  받아 매칭 — preview-recipients / load-all-group-recipients 가 학생 ID·제외 목록을 GET
  URL 에 박아 414 나던 문제 회피. 정렬(registered_at DESC, 반환 컬럼엔 미포함) 후
  OFFSET/LIMIT + 윈도우 total_count. 시맨틱: 탈퇴 제외, include_ids=custom 모집단,
  subjects=classes 경유, regions=school_regions 매핑, 제외 3종(개별/학교/강좌). INVOKER.';

COMMIT;
