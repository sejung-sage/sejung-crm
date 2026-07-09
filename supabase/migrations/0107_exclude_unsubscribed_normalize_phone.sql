-- ============================================================
-- 0107_exclude_unsubscribed_normalize_phone.sql
-- 0106 의 수신거부 비교를 "번호 표기에 무관"하게 고친다.
-- ------------------------------------------------------------
-- 버그(2026-07-09, 0106 배포 직후 프로덕션에서 재현):
--   0106 은 `u.phone = s.parent_phone` 등가 비교를 썼다. crm_students 의 번호가 ETL
--   (normalize_phone)을 거쳐 항상 숫자만 저장된다는 전제였다.
--
--   실제 프로덕션은 parent_phone 107,740 건이 숫자만, **4 건이 하이픈 표기**였다.
--   하이픈 행은 CRM 화면의 학생 등록(createStudentAction)이 입력값을 정규화 없이
--   그대로 INSERT 해서 생긴다. 그 4 건에 대해 등가 비교가 어긋나 수신거부가
--   **조용히 무력화**됐다. 수신거부 등록된 '010-4670-9346' 학생이
--   search_recipients_bulk(p_exclude_unsubscribed => true) 결과에 그대로 나왔다.
--
--   수신거부는 "조용히 실패하면 안 되는" 가드다. 데이터 표기에 의존하지 않게 만든다.
--
-- 수정:
--   양쪽을 regexp_replace 로 숫자만 남겨 비교한다. crm_unsubscribes 는 0106 의 CHECK
--   제약으로 이미 숫자만이지만, 방어적으로 함께 정규화한다(제약이 제거돼도 안전).
--   수신거부 목록은 작으므로 CTE 로 한 번만 정규화해 두고 EXISTS 로 조회한다.
--
-- 성능: 학생 행당 regexp_replace 2회. 분원 최대 코호트(~65k)에서도 무시할 수준이고,
--   unsub CTE 는 한 번만 계산된다.
--
-- 범위: 0106 이 만든 두 함수의 `cleaned` CTE 비교식만 바꾼다. 시그니처·반환 타입·
--   나머지 필터 시맨틱은 0106 과 100% 동일하므로 CREATE OR REPLACE 로 충분하다.
--
-- 남은 근본 원인(별도 처리): createStudentAction 이 parent_phone/phone 을 정규화하지
--   않고 저장한다. 본 마이그레이션으로 발송 가드는 표기와 무관해졌으나, 저장 표기를
--   통일하는 것은 애플리케이션 레이어에서 따로 고친다.
--
-- 롤백: 파일 하단 참조(0106 의 정의로 되돌림).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- search_recipients — 정규화 비교
-- ------------------------------------------------------------
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
  p_exclude_unsubscribed boolean DEFAULT false,
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
  WITH unsub AS (
    -- 수신거부 번호를 숫자만으로 정규화해 한 번만 계산.
    SELECT DISTINCT regexp_replace(u.phone, '[^0-9]', '', 'g') AS p
    FROM public.crm_unsubscribes u
  ),
  base AS (
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
  ),
  -- 수신거부 번호를 **번호 단위**로 가린다(학생 단위 아님).
  -- 비교는 양쪽 모두 숫자만으로 정규화 — 저장 표기('010-1234-5678' vs '01012345678')가
  -- 달라도 반드시 매칭된다. NULL 번호는 regexp_replace 도 NULL 이라 EXISTS 가 거짓.
  cleaned AS (
    SELECT b.id, b.name, b.status, b.registered_at,
           CASE WHEN p_exclude_unsubscribed AND EXISTS (
                  SELECT 1 FROM unsub
                   WHERE unsub.p = regexp_replace(b.parent_phone, '[^0-9]', '', 'g')
                ) THEN NULL ELSE b.parent_phone END AS parent_phone,
           CASE WHEN p_exclude_unsubscribed AND EXISTS (
                  SELECT 1 FROM unsub
                   WHERE unsub.p = regexp_replace(b.phone, '[^0-9]', '', 'g')
                ) THEN NULL ELSE b.phone END AS phone
    FROM base b
  ),
  matched AS (
    SELECT c.*
    FROM cleaned c
    -- 학부모 번호 필수(미리보기 eligible/샘플)는 **가린 뒤** 평가 → 학부모 수신거부 탈락.
    WHERE (NOT p_require_parent_phone OR c.parent_phone IS NOT NULL)
      -- 보낼 수 있는 번호가 하나도 안 남은 학생만 행 제외.
      AND (NOT p_exclude_unsubscribed
           OR c.parent_phone IS NOT NULL OR c.phone IS NOT NULL)
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
  '일반 수신자 검색 RPC(0093/0094/0106/0107). 모든 필터+ID 배열을 요청 본문으로 받아
  매칭 — 414 회피. 정렬(registered_at DESC) 후 OFFSET/LIMIT + 윈도우 total_count.
  시맨틱: 탈퇴 제외, include_ids=custom 모집단, subjects=classes 경유,
  regions=school_regions 매핑, 제외 3종(개별/학교/강좌). p_exclude_unsubscribed=true 면
  crm_unsubscribes 를 직접 조회해 수신거부 번호를 번호 단위로 NULL 처리하고, 남은 번호가
  없는 학생은 제외. 비교는 양쪽 숫자만 정규화라 하이픈 표기에도 뚫리지 않는다(0107).
  SECURITY INVOKER.';

-- ------------------------------------------------------------
-- search_recipients_bulk — 정규화 비교
-- ------------------------------------------------------------
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
  p_exclude_unsubscribed boolean DEFAULT false,
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

  WITH unsub AS (
    SELECT DISTINCT regexp_replace(u.phone, '[^0-9]', '', 'g') AS p
    FROM public.crm_unsubscribes u
  ),
  base AS (
    SELECT s.id, s.name, s.parent_phone, s.phone, s.registered_at
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
  ),
  cleaned AS (
    SELECT b.id, b.name, b.registered_at,
           CASE WHEN p_exclude_unsubscribed AND EXISTS (
                  SELECT 1 FROM unsub
                   WHERE unsub.p = regexp_replace(b.parent_phone, '[^0-9]', '', 'g')
                ) THEN NULL ELSE b.parent_phone END AS parent_phone,
           CASE WHEN p_exclude_unsubscribed AND EXISTS (
                  SELECT 1 FROM unsub
                   WHERE unsub.p = regexp_replace(b.phone, '[^0-9]', '', 'g')
                ) THEN NULL ELSE b.phone END AS phone
    FROM base b
  ),
  matched AS (
    SELECT c.id, c.name, c.parent_phone, c.phone,
           row_number() OVER (ORDER BY c.registered_at DESC NULLS LAST, c.id) AS rn,
           count(*) OVER () AS total
    FROM cleaned c
    WHERE (NOT p_require_parent_phone OR c.parent_phone IS NOT NULL)
      AND (NOT p_exclude_unsubscribed
           OR c.parent_phone IS NOT NULL OR c.phone IS NOT NULL)
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
  '매칭 학생 전원을 1회 호출로 반환(0095/0106/0107). scalar jsonb 라 PostgREST
  max_rows(1000) 미적용 → 전량 로드. 반환 {total, rows[≤p_max]}. 필터 시맨틱은
  search_recipients 와 동일하며 p_exclude_unsubscribed=true 면 수신거부 번호를 번호
  단위로 NULL 처리(양쪽 숫자만 정규화 비교)하고 남은 번호가 없는 학생은 제외한다.
  SECURITY INVOKER.';

COMMIT;

-- ============================================================
-- ROLLBACK (수동): 0106 의 함수 정의를 다시 적용한다.
--   (등가 비교로 되돌아가므로 하이픈 표기 행에서 수신거부가 무력화된다 — 권장하지 않음)
-- ============================================================
