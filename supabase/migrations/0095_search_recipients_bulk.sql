-- ============================================================
-- 0095_search_recipients_bulk.sql
-- 매칭 학생 "전원"을 한 번의 호출로 반환하는 bulk RPC.
-- ------------------------------------------------------------
-- 배경:
--   문자 작성 매칭 명단은 화면 상한(1만)까지만 보여줬다. 운영자가 "1만 명 너머까지
--   전부 보고 고르고 싶다"고 요청. 그러나 search_recipients(0093/0094)는
--   table-returning + PostgREST max_rows=1000 이라 전량 로드에 offset 페이징이
--   필요했고(대치 64k = 65콜 ~20초) 너무 느렸다.
--
--   본 함수는 scalar jsonb 를 반환한다 → PostgREST max_rows 가 적용되지 않아
--   1회 호출로 전원을 받는다(64k ~3초). 프런트는 가상 스크롤로 렌더한다.
--
-- 반환: jsonb { total: 매칭 전체 수, rows: [{id,name,parent_phone,phone}, ...] }
--   rows 는 안전 상한 p_max 까지(기본 100,000 — 분원 최대 코호트도 덮음).
--   정렬은 호출자(클라이언트)가 이름 가나다순으로 다시 한다(ko collation).
--
-- 필터 시맨틱은 search_recipients(0093/0094)와 100% 동일 — WHERE 절을 그대로 복제.
-- 보안: SECURITY INVOKER(호출자 RLS).
--
-- 롤백: DROP FUNCTION public.search_recipients_bulk(...).
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.search_recipients_bulk(
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
  p_max int DEFAULT 100000
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_wanted_statuses text[];
  v_exclude_aca_class_ids text[];
  v_unmapped text[] := ARRAY[
    '고','고고','고등학교','중','중중','중학교','초','초등','초등학교','대학교','재수'
  ];
  v_total bigint;
  v_rows jsonb;
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

  WITH matched AS (
    SELECT s.id, s.name, s.parent_phone, s.phone,
           row_number() OVER (ORDER BY s.registered_at DESC NULLS LAST, s.id) AS rn,
           count(*) OVER () AS total
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
  )
  SELECT
    COALESCE(max(m.total), 0),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', m.id, 'name', m.name,
          'parent_phone', m.parent_phone, 'phone', m.phone
        )
        ORDER BY m.rn
      ) FILTER (WHERE m.rn <= p_max),
      '[]'::jsonb
    )
  INTO v_total, v_rows
  FROM matched m;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END;
$$;

COMMENT ON FUNCTION public.search_recipients_bulk IS
  '매칭 학생 전원을 1회 호출로 반환(0095). scalar jsonb 라 PostgREST max_rows(1000)
  미적용 → 전량 로드. 반환 {total, rows[≤p_max]}. 필터 시맨틱은 search_recipients
  (0093/0094)와 동일. 문자 작성 매칭 명단 "전부 표시"(가상 스크롤) 용. INVOKER.';

COMMIT;

-- ROLLBACK: DROP FUNCTION IF EXISTS public.search_recipients_bulk(
--   text, text[], text[], text[], text[], text[], boolean, boolean,
--   uuid[], uuid[], text[], uuid[], boolean, int);
