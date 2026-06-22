-- ============================================================
-- 0093_search_recipients_general_rpc.sql
-- 일반 수신자 검색 RPC — 미리보기/발송이 학생 ID·제외 목록을 PostgREST GET URL 에
-- 박아 Cloudflare 414(Request-URI Too Large) 로 죽던 문제를 해소한다.
-- ------------------------------------------------------------
-- 배경:
--   문자 작성 화면에서 "전체 해제 후 몇 명만 선택"(excludeStudentIds 수천~1만) 하거나
--   과목 필터(subjects → 학생 ID 사전매핑 수천 건)를 쓰면, preview-recipients /
--   load-all-group-recipients 가 그 ID 배열을 `.in()` / `.not.in()` 으로 URL 에 직렬화해
--   URL 길이 한도를 초과 → 미리보기 "발송 대상 0명" + 발송 실패.
--
--   기존 search_recipients_by_subjects(0068/0076) 는 같은 회피책을 "과목 필터일 때만"
--   적용했다. 본 RPC 는 그것을 일반화 — subjects 유무와 무관하게 모든 필터값과 ID 배열을
--   "요청 본문(POST)"으로 받아 매칭한다. 호출부는 GET URL 에 큰 목록을 싣지 않는다.
--
-- 필터 시맨틱 (count-recipients / load-all-group-recipients / preview-recipients 와 동일):
--   - status: 항상 '탈퇴' 제외. p_statuses 빈/NULL = "탈퇴 빼고 3종 전체".
--   - p_include_ids: custom(고정 명단) 모집단. 있으면 그 집합으로 한정.
--   - p_subjects: classes.subject 로 aca_class_id → enrollments 매칭(EXISTS). ETL 상
--     enrollments.subject 가 NULL 이라 classes 경유. (7종 전체 = 미적용은 호출부가 NULL 화)
--   - p_regions: crm_school_regions 매핑(LEFT JOIN). 미매핑 학교는 '기타'.
--   - p_mapped_school / p_unmapped_school: 학교 등록만 / 미등록만(placeholder 패턴).
--   - 제외 3종: 개별(p_exclude_ids) / 학교별(p_exclude_schools) / 강좌별(p_exclude_class_ids
--     = crm_classes.id → aca_class_id 동적 차감). exclude 승리.
--   - p_require_parent_phone: 미리보기 eligible/샘플은 학부모 번호 필수(true). 발송 loader 는
--     학생 레그도 있어 false(parent_phone NULL 행도 반환).
--
-- 반환: 정렬(registered_at DESC NULLS LAST, id) 후 OFFSET/LIMIT 한 행들 + 윈도우 total_count.
--   샘플/카운트(작은 limit)와 전량 로드(큰 limit) 모두 이 한 함수로 처리.
--
-- 보안: 기존 RPC 와 동일 SECURITY INVOKER (호출자 RLS 그대로 적용).
--
-- 롤백: DROP FUNCTION public.search_recipients(...) (아래 ROLLBACK 블록).
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.search_recipients(
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
  registered_at timestamptz,
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
  -- statuses 기본값 = "탈퇴 빼고 전체"(옛 그룹 JSONB 호환). 빈 배열도 default 로.
  v_wanted_statuses := COALESCE(
    NULLIF(p_statuses, ARRAY[]::text[]),
    ARRAY['재원생', '수강이력자', '수강 x']
  );

  -- 강좌별 제외: crm_classes.id → aca_class_id. NULL(자체등록 강좌)은 매칭 불가라 자연 탈락.
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
      -- custom 고정 명단 모집단.
      AND (p_include_ids IS NULL OR array_length(p_include_ids, 1) IS NULL
           OR s.id = ANY(p_include_ids))
      AND (p_grades IS NULL OR array_length(p_grades, 1) IS NULL
           OR s.grade::text = ANY(p_grades))
      AND (p_schools IS NULL OR array_length(p_schools, 1) IS NULL
           OR s.school = ANY(p_schools))
      -- 지역: crm_school_regions 매핑(앱의 allowedSchools 사전매핑과 동일 — EXISTS).
      --   매핑 없는 학교는 어떤 지역에도 안 잡힘(기존 비-과목 경로 동작 보존).
      AND (p_regions IS NULL OR array_length(p_regions, 1) IS NULL
           OR EXISTS (
             SELECT 1 FROM public.crm_school_regions sr
              WHERE sr.school = s.school AND sr.region = ANY(p_regions)
           ))
      -- 과목 매칭 (classes JOIN enrollments).
      AND (p_subjects IS NULL OR array_length(p_subjects, 1) IS NULL
           OR EXISTS (
             SELECT 1
               FROM public.crm_enrollments e
               JOIN public.crm_classes c ON c.aca_class_id = e.aca_class_id
              WHERE e.student_id = s.id
                AND c.subject = ANY(p_subjects)
           ))
      -- 학교 등록만 / 미등록만.
      AND (NOT p_unmapped_school
           OR s.school IS NULL OR s.school = ANY(v_unmapped))
      AND (NOT p_mapped_school
           OR (s.school IS NOT NULL AND NOT (s.school = ANY(v_unmapped))))
      -- 개별 제외.
      AND (p_exclude_ids IS NULL OR array_length(p_exclude_ids, 1) IS NULL
           OR NOT (s.id = ANY(p_exclude_ids)))
      -- 학교별 제외 (school NULL 은 유지).
      AND (p_exclude_schools IS NULL OR array_length(p_exclude_schools, 1) IS NULL
           OR s.school IS NULL OR NOT (s.school = ANY(p_exclude_schools)))
      -- 강좌별 제외 (제외 강좌 수강생 탈락). 발송 시점 enrollments 현재 상태 반영.
      AND (v_exclude_aca_class_ids IS NULL
           OR array_length(v_exclude_aca_class_ids, 1) IS NULL
           OR NOT EXISTS (
             SELECT 1
               FROM public.crm_enrollments ex
              WHERE ex.student_id = s.id
                AND ex.aca_class_id = ANY(v_exclude_aca_class_ids)
           ))
      -- 미리보기 eligible/샘플은 학부모 번호 필수. 발송 loader 는 false.
      AND (NOT p_require_parent_phone OR s.parent_phone IS NOT NULL)
  ),
  counted AS (
    SELECT m.*, COUNT(*) OVER () AS total_count
    FROM matched m
  )
  SELECT c.id, c.name, c.parent_phone, c.phone, c.status,
         c.registered_at, c.total_count
  FROM counted c
  ORDER BY c.registered_at DESC NULLS LAST, c.id
  OFFSET p_offset
  LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION public.search_recipients IS
  '일반 수신자 검색 RPC(0093). subjects 유무 무관 모든 필터+ID 배열을 요청 본문으로
  받아 매칭 — preview-recipients / load-all-group-recipients 가 학생 ID·제외 목록을
  GET URL 에 박아 414 나던 문제 회피. 정렬 후 OFFSET/LIMIT + 윈도우 total_count 반환
  (작은 limit=카운트·샘플, 큰 limit=전량 로드). 시맨틱은 count-recipients 와 동일:
  탈퇴 제외, include_ids=custom 모집단, subjects=classes 경유, regions=school_regions
  매핑, 제외 3종(개별/학교/강좌). SECURITY INVOKER.';

COMMIT;

-- ============================================================
-- ROLLBACK (수동):
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.search_recipients(
--   text, text[], text[], text[], text[], text[], boolean, boolean,
--   uuid[], uuid[], text[], uuid[], boolean, int, int
-- );
-- COMMIT;
-- ============================================================
