-- ============================================================
-- 0106_search_recipients_exclude_unsubscribed.sql
-- 수신거부 번호를 발송 대상 조회(리스트업)에서 SQL 레벨로 제외한다.
-- ------------------------------------------------------------
-- 배경(2026-07-09 버그):
--   수신거부(crm_unsubscribes)는 지금까지 "메시지 생성 시점"의 애플리케이션(JS)
--   필터에서만 적용됐다. 발송 대상 조회 RPC(search_recipients / _bulk)에는 수신거부
--   조건이 한 줄도 없어서
--     - 문자 작성 화면의 매칭 학생 명단(listMatchedRecipients → _bulk)
--     - 미리보기의 "발송 대상 N명" · 샘플(preview-recipients → search_recipients)
--   에 수신거부 번호가 그대로 노출됐다. 운영자 눈에는 "수신거부가 안 먹는다".
--
--   (참고: search_recipients_by_subjects(0068/0076) 는 이미 p_unsub_phones 를 받아
--    제외하고 있었다. search_recipients 계열만 누락된 상태였다.)
--
-- 설계:
--   1) 호출자가 수신거부 목록을 넘기지 않는다. RPC 가 crm_unsubscribes 를 직접 조회한다.
--      → "넘기는 걸 잊어서 뚫리는" 경로가 원천적으로 생기지 않는다.
--      (0068 의 p_unsub_phones 방식 대비 안전. 해당 RPC 는 본 마이그 범위 밖이라 유지.)
--   2) 제외는 **번호 단위**다. 학생 단위가 아니다.
--      - parent_phone 이 수신거부면 parent_phone 만 NULL 로 가린다.
--      - phone(학생 본인)이 수신거부면 phone 만 NULL 로 가린다.
--      - 두 번호가 모두 사라진 학생만 행 자체를 제외한다.
--      학부모만 수신거부한 학생에게 "학생 본인 번호로" 보내는 경로(0077 학생 레그)를
--      죽이지 않기 위함. 이 시맨틱은 expandRecipientLegs 의 레그별 필터와 동일하다.
--   3) p_require_parent_phone 은 **가린 뒤** 평가한다. 학부모 수신거부 학생은
--      미리보기 eligible(학부모 번호 필수)에서 자연 탈락한다.
--
--   신규 파라미터 p_exclude_unsubscribed 는 DEFAULT false — 기본 동작은 종전과 동일.
--   true 를 넘기는 호출자만 제외가 적용된다.
--     · preview-recipients(미리보기)      → true
--     · compose listMatchedRecipients(명단) → true
--     · load-all-group-recipients(발송 로더) → false 유지.
--         발송 로더는 수신거부 레그를 JS 까지 살려 보내 캠페인 상세에
--         '실패(수신거부)' 감사 행으로 남긴다. SQL 에서 미리 지우면 그 행이 사라진다.
--
-- 번호 표기 정규화:
--   crm_students.parent_phone / phone 은 ETL(normalize_phone)이 숫자만 저장한다.
--   crm_unsubscribes.phone 은 하이픈이 섞여 들어갈 수 있어 `u.phone = s.parent_phone`
--   등가 비교가 어긋날 수 있었다. 기존 행을 숫자만으로 정규화하고, 앞으로도 그렇게만
--   들어오도록 CHECK 제약을 건다. (PK 인덱스를 그대로 타 EXISTS 조회가 빠르다.)
--
-- 파라미터 추가 = 시그니처 변경 → CREATE OR REPLACE 불가(오버로드 충돌). DROP 후 재생성.
--
-- ⚠️ RLS 주의: 두 함수는 SECURITY INVOKER 다. p_exclude_unsubscribed=true 로 부르는
--    호출자가 crm_unsubscribes 를 SELECT 할 수 없으면 EXISTS 가 조용히 거짓이 되어
--    **가드가 소리 없이 꺼진다**. 현재 read 정책은 "로그인한 활성 사용자 전원"이고,
--    true 를 넘기는 두 호출자(preview-recipients / compose listMatchedRecipients)는
--    service role 클라이언트라 RLS 를 우회한다. 새 호출자를 붙일 때 이 전제를 확인할 것.
--
-- 롤백: 파일 하단 ROLLBACK 블록 참조.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) crm_unsubscribes.phone 정규화 (하이픈/공백 제거)
-- ------------------------------------------------------------

-- 1-a) 정규화하면 서로 충돌할 행 정리 — 먼저 수신거부한 행(가장 오래된 것)만 남긴다.
--      예: '010-1234-5678' 과 '01012345678' 이 공존하는 경우.
DELETE FROM public.crm_unsubscribes a
USING public.crm_unsubscribes b
WHERE regexp_replace(a.phone, '[^0-9]', '', 'g')
    = regexp_replace(b.phone, '[^0-9]', '', 'g')
  AND (COALESCE(a.unsubscribed_at, 'epoch'::timestamptz), a.ctid)
    > (COALESCE(b.unsubscribed_at, 'epoch'::timestamptz), b.ctid);

-- 1-b) 숫자만 남긴다.
UPDATE public.crm_unsubscribes
   SET phone = regexp_replace(phone, '[^0-9]', '', 'g')
 WHERE phone <> regexp_replace(phone, '[^0-9]', '', 'g');

-- 1-c) 숫자가 하나도 없던 쓰레기 행 제거. 어떤 번호와도 매칭될 수 없어 삭제해도
--      수신거부 보호가 약해지지 않는다.
DELETE FROM public.crm_unsubscribes WHERE phone = '';

-- 1-d) 앞으로도 숫자만 저장되도록 강제. 하이픈 섞인 INSERT 는 조용히 매칭 실패하는
--      대신 즉시 에러가 난다(수신거부는 조용히 실패하면 안 되는 안전 장치).
ALTER TABLE public.crm_unsubscribes
  DROP CONSTRAINT IF EXISTS crm_unsubscribes_phone_digits_only;
ALTER TABLE public.crm_unsubscribes
  ADD CONSTRAINT crm_unsubscribes_phone_digits_only
  CHECK (phone ~ '^[0-9]+$');

COMMENT ON CONSTRAINT crm_unsubscribes_phone_digits_only
  ON public.crm_unsubscribes IS
  '수신거부 번호는 하이픈 없는 숫자만 저장(0106). crm_students.parent_phone/phone 과
  등가 비교하기 위함 — 표기가 어긋나면 수신거부가 조용히 무력화된다.';

COMMENT ON COLUMN public.crm_unsubscribes.phone IS
  '수신 거부 번호 (하이픈 없는 숫자만. 발송 시 반드시 제외)';

-- ------------------------------------------------------------
-- 2) search_recipients — p_exclude_unsubscribed 추가
-- ------------------------------------------------------------

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
  WITH base AS (
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
  -- 수신거부 번호를 **번호 단위**로 가린다(학생 단위 아님). NULL 인 번호는 EXISTS 가
  -- 거짓이라 그대로 NULL 유지.
  cleaned AS (
    SELECT b.id, b.name, b.status, b.registered_at,
           CASE WHEN p_exclude_unsubscribed AND EXISTS (
                  SELECT 1 FROM public.crm_unsubscribes u WHERE u.phone = b.parent_phone
                ) THEN NULL ELSE b.parent_phone END AS parent_phone,
           CASE WHEN p_exclude_unsubscribed AND EXISTS (
                  SELECT 1 FROM public.crm_unsubscribes u WHERE u.phone = b.phone
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
  '일반 수신자 검색 RPC(0093/0094/0106). 모든 필터+ID 배열을 요청 본문으로 받아 매칭
  — 학생 ID·제외 목록을 GET URL 에 박아 414 나던 문제 회피. 정렬(registered_at DESC,
  반환 컬럼엔 미포함) 후 OFFSET/LIMIT + 윈도우 total_count. 시맨틱: 탈퇴 제외,
  include_ids=custom 모집단, subjects=classes 경유, regions=school_regions 매핑,
  제외 3종(개별/학교/강좌). p_exclude_unsubscribed=true 면 crm_unsubscribes 를 직접
  조회해 수신거부 번호를 번호 단위로 NULL 처리하고, 남은 번호가 없는 학생은 제외
  (0106). p_require_parent_phone 은 가린 뒤 평가. SECURITY INVOKER.';

-- ------------------------------------------------------------
-- 3) search_recipients_bulk — p_exclude_unsubscribed 추가
--    WHERE 절 시맨틱은 위 search_recipients 와 100% 동일하게 유지.
-- ------------------------------------------------------------

DROP FUNCTION IF EXISTS public.search_recipients_bulk(
  text, text[], text[], text[], text[], text[], boolean, boolean,
  uuid[], uuid[], text[], uuid[], boolean, int
);

CREATE FUNCTION public.search_recipients_bulk(
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

  WITH base AS (
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
                  SELECT 1 FROM public.crm_unsubscribes u WHERE u.phone = b.parent_phone
                ) THEN NULL ELSE b.parent_phone END AS parent_phone,
           CASE WHEN p_exclude_unsubscribed AND EXISTS (
                  SELECT 1 FROM public.crm_unsubscribes u WHERE u.phone = b.phone
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
  '매칭 학생 전원을 1회 호출로 반환(0095/0106). scalar jsonb 라 PostgREST max_rows(1000)
  미적용 → 전량 로드. 반환 {total, rows[≤p_max]}. 필터 시맨틱은 search_recipients 와
  동일하며 p_exclude_unsubscribed=true 면 수신거부 번호를 번호 단위로 NULL 처리하고
  남은 번호가 없는 학생은 제외한다. 문자 작성 매칭 명단 용. SECURITY INVOKER.';

COMMIT;

-- ============================================================
-- ROLLBACK (수동):
-- BEGIN;
-- ALTER TABLE public.crm_unsubscribes
--   DROP CONSTRAINT IF EXISTS crm_unsubscribes_phone_digits_only;
-- DROP FUNCTION IF EXISTS public.search_recipients(
--   text, text[], text[], text[], text[], text[], boolean, boolean,
--   uuid[], uuid[], text[], uuid[], boolean, boolean, int, int);
-- DROP FUNCTION IF EXISTS public.search_recipients_bulk(
--   text, text[], text[], text[], text[], text[], boolean, boolean,
--   uuid[], uuid[], text[], uuid[], boolean, boolean, int);
-- -- 이후 0094 / 0095 를 다시 적용해 이전 시그니처를 복원한다.
-- -- (1) 의 phone 정규화는 데이터 정정이라 되돌리지 않는다.
-- COMMIT;
-- ============================================================
