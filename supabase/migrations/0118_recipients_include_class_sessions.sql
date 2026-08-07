-- ============================================================
-- 0118_recipients_include_class_sessions.sql
-- 수신자 검색에 "강좌 + 회차(수업일)" 포함 필터 추가
-- ------------------------------------------------------------
-- 배경 (2026-08-07 요청 · 개강문자):
--   지금 /compose 의 강좌 조건은 "이 강좌 수강생 **제외**" 뿐이라,
--   "이 강좌 수강생에게 개강 안내" 같은 포함 발송을 만들 수 없다.
--   강좌를 고르고 → 그 강좌의 수업일(회차)을 골라, 그날 수업 듣는 학생에게만
--   보낼 수 있도록 포함 필터를 추가한다.
--
-- 기준 테이블 = aca_tickets (수강권), crm_enrollments 아님:
--   aca_tickets 는 "학생 × 수업일(class_date)" 단위로 1행씩이라 회차 명단을
--   정확히 뽑을 수 있다(8회 중 7회만 듣는 학생은 안 듣는 날 행이 없다).
--   crm_enrollments 는 강좌 전체 등록이라 회차 구분이 불가능하다.
--   → 강좌 필터와 회차 필터가 같은 소스를 써야 모집단이 어긋나지 않으므로
--     포함 필터는 강좌 단위에서도 aca_tickets 를 쓴다.
--   (기존 **제외** 필터는 enrollments 기준 그대로 둔다 — 동작 변경 없음.)
--
-- 조인 키 (scripts/etl/migrate_tickets.py:269-270 확인):
--   aca_tickets.aca_student_id = crm_students.aca2000_id  ("{branch_id}-{학생_코드}")
--   aca_tickets.aca_class_id   = crm_classes.aca_class_id ("{branch_id}-{반고유_코드}")
--   ⚠️ 0054 의 COMMENT 는 접두사 없이 적혀 있으나 실제 적재값은 접두사를 포함한다.
--
-- 시맨틱:
--   p_include_class_ids   NULL/빈배열 → 강좌 조건 미적용(전원).
--                         값 있음     → 그 강좌들에 티켓 있는 학생만.
--   p_include_class_dates NULL/빈배열 → 선택 강좌의 전 회차.
--                         값 있음     → 그 수업일의 티켓만.
--   선택한 강좌가 전부 aca_class_id NULL(자체 등록 강좌)이면 매칭 0명으로 확정한다
--   (v_include_class_filter 플래그). 조건을 조용히 무시해 전원에게 나가는 사고 방지 —
--   발송은 되돌릴 수 없으므로 "모르면 0명" 이 안전한 기본값이다.
--
-- 기반: 0107 의 정의를 그대로 확장한다. 특히 수신거부 비교의 숫자 정규화
--   (regexp_replace) 는 0107 이 고친 가드라 반드시 유지한다.
--
-- ROLLBACK:
--   0107 의 두 함수 정의를 다시 적용(파라미터 2개가 빠진 시그니처).
--   DROP FUNCTION IF EXISTS public.search_recipients(
--     text, text[], text[], text[], text[], text[], boolean, boolean,
--     uuid[], uuid[], text[], uuid[], boolean, boolean, uuid[], date[], int, int);
--   DROP FUNCTION IF EXISTS public.search_recipients_bulk(
--     text, text[], text[], text[], text[], text[], boolean, boolean,
--     uuid[], uuid[], text[], uuid[], boolean, boolean, uuid[], date[], int);
--   DROP INDEX IF EXISTS public.idx_aca_tickets_class_student;
-- ============================================================

-- ─── 1) 커버링 인덱스 (트랜잭션 밖) ──────────────────────────
--
-- 0112 와 동일한 이유로 BEGIN 밖에 둔다. 이 CREATE INDEX 는 SHARE 락이라 빌드 동안
-- aca_tickets 쓰기(상시 노트북 ETL 동기화)가 막힌다. ETL 이 도는 정각 근처는 피해서 적용할 것.
--
-- 컬럼 순서: aca_class_id(등치) → class_date(등치/IN) → aca_student_id(뽑는 값).
-- 셋 다 인덱스에 있어 세미조인이 index-only scan 으로 끝난다.
-- aca_student_id IS NULL 행은 학생 매칭이 불가해 결과에서 빠지므로 부분 인덱스로 제외.
CREATE INDEX IF NOT EXISTS idx_aca_tickets_class_student
  ON public.aca_tickets (aca_class_id, class_date, aca_student_id)
  WHERE aca_student_id IS NOT NULL;

COMMENT ON INDEX public.idx_aca_tickets_class_student IS
  '강좌+회차 포함 필터용 커버링 인덱스 — search_recipients 의 aca_tickets 세미조인이 index-only scan 으로 끝나게 한다. 0118.';

BEGIN;

-- ------------------------------------------------------------
-- 2) search_recipients — 강좌/회차 포함 필터 추가
-- ------------------------------------------------------------
-- 파라미터가 늘어 시그니처가 바뀌므로 0107 정의를 DROP 후 재생성한다.
DROP FUNCTION IF EXISTS public.search_recipients(
  text, text[], text[], text[], text[], text[], boolean, boolean,
  uuid[], uuid[], text[], uuid[], boolean, boolean, int, int
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
  p_include_class_ids uuid[] DEFAULT NULL,
  p_include_class_dates date[] DEFAULT NULL,
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
  v_include_aca_class_ids text[];
  -- 강좌 포함 조건이 걸렸는지. 선택 강좌가 전부 aca_class_id NULL 이어도 조건을
  -- 무시하지 않고 "매칭 0명" 으로 확정하기 위한 플래그.
  v_include_class_filter boolean := false;
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

  IF p_include_class_ids IS NOT NULL
     AND array_length(p_include_class_ids, 1) > 0 THEN
    v_include_class_filter := true;
    SELECT array_agg(c.aca_class_id)
      INTO v_include_aca_class_ids
      FROM public.crm_classes c
     WHERE c.id = ANY(p_include_class_ids)
       AND c.aca_class_id IS NOT NULL;
    -- 전부 자체 등록 강좌(aca_class_id NULL)면 빈 배열 → 아래 EXISTS 가 항상 거짓 → 0명.
    IF v_include_aca_class_ids IS NULL THEN
      v_include_aca_class_ids := ARRAY[]::text[];
    END IF;
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
      -- 강좌 + 회차 포함 필터 (0118). aca_tickets 세미조인.
      --   회차 미지정 → 그 강좌의 전 회차. 지정 → 그 수업일 티켓만.
      --   aca2000_id 가 NULL 인 학생(아카 미매핑)은 티켓이 붙을 수 없어 자연 탈락.
      AND (NOT v_include_class_filter
           OR EXISTS (
             SELECT 1
               FROM public.aca_tickets t
              WHERE t.aca_student_id = s.aca2000_id
                AND t.aca_class_id = ANY(v_include_aca_class_ids)
                AND (p_include_class_dates IS NULL
                     OR array_length(p_include_class_dates, 1) IS NULL
                     OR t.class_date = ANY(p_include_class_dates))
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
  '일반 수신자 검색 RPC(0093/0094/0106/0107/0118). 모든 필터+ID 배열을 요청 본문으로
  받아 매칭 — 414 회피. 정렬(registered_at DESC) 후 OFFSET/LIMIT + 윈도우 total_count.
  시맨틱: 탈퇴 제외, include_ids=custom 모집단, subjects=classes 경유,
  regions=school_regions 매핑, 제외 3종(개별/학교/강좌). p_exclude_unsubscribed=true 면
  수신거부 번호를 번호 단위로 NULL 처리(양쪽 숫자만 정규화 비교 — 0107).
  0118: 강좌+회차 포함 필터(p_include_class_ids / p_include_class_dates) 추가 —
  aca_tickets 세미조인으로 "이 강좌 이 수업일에 수강권이 있는 학생"(개강문자).
  회차 미지정이면 그 강좌 전 회차. SECURITY INVOKER.';

-- ------------------------------------------------------------
-- 3) search_recipients_bulk — 동일 필터 추가
-- ------------------------------------------------------------
-- 매칭 명단(체크박스 UI)과 미리보기 카운트가 같은 조건을 봐야 하므로 두 함수는 항상
-- 같이 고친다. 한쪽만 고치면 "명단엔 있는데 발송은 안 됨" 류의 사고가 난다.
DROP FUNCTION IF EXISTS public.search_recipients_bulk(
  text, text[], text[], text[], text[], text[], boolean, boolean,
  uuid[], uuid[], text[], uuid[], boolean, boolean, int
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
  p_include_class_ids uuid[] DEFAULT NULL,
  p_include_class_dates date[] DEFAULT NULL,
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
  v_include_aca_class_ids text[];
  v_include_class_filter boolean := false;
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

  IF p_include_class_ids IS NOT NULL
     AND array_length(p_include_class_ids, 1) > 0 THEN
    v_include_class_filter := true;
    SELECT array_agg(c.aca_class_id)
      INTO v_include_aca_class_ids
      FROM public.crm_classes c
     WHERE c.id = ANY(p_include_class_ids)
       AND c.aca_class_id IS NOT NULL;
    IF v_include_aca_class_ids IS NULL THEN
      v_include_aca_class_ids := ARRAY[]::text[];
    END IF;
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
      -- 강좌 + 회차 포함 필터 (0118). search_recipients 와 동일 조건.
      AND (NOT v_include_class_filter
           OR EXISTS (
             SELECT 1
               FROM public.aca_tickets t
              WHERE t.aca_student_id = s.aca2000_id
                AND t.aca_class_id = ANY(v_include_aca_class_ids)
                AND (p_include_class_dates IS NULL
                     OR array_length(p_include_class_dates, 1) IS NULL
                     OR t.class_date = ANY(p_include_class_dates))
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
  '매칭 학생 전원을 1회 호출로 반환(0095/0106/0107/0118). scalar jsonb 라 PostgREST
  max_rows(1000) 미적용 → 전량 로드. 반환 {total, rows[≤p_max]}. 필터 시맨틱은
  search_recipients 와 동일하며 p_exclude_unsubscribed=true 면 수신거부 번호를 번호
  단위로 NULL 처리(양쪽 숫자만 정규화 비교)하고 남은 번호가 없는 학생은 제외한다.
  0118: 강좌+회차 포함 필터 추가. SECURITY INVOKER.';

COMMIT;

-- ------------------------------------------------------------
-- 4) 회차(수업일) 목록 RPC — 강좌 클릭 → 회차 클릭 UI 용
-- ------------------------------------------------------------
-- 강좌 하나의 수업일 목록과 그날 인원수를 가볍게 반환한다.
-- getClassSessions(src/lib/classes/get-class-sessions.ts)는 학생 메타까지 전부
-- 끌어와 회차 격자를 그리는 무거운 로더라, 드롭다운 채우기에는 과하다.
BEGIN;

CREATE OR REPLACE FUNCTION public.crm_class_session_dates(
  p_class_id uuid
)
RETURNS TABLE(
  class_date date,
  student_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT t.class_date,
         COUNT(DISTINCT t.aca_student_id) AS student_count
    FROM public.aca_tickets t
    JOIN public.crm_classes c ON c.aca_class_id = t.aca_class_id
   WHERE c.id = p_class_id
     AND t.class_date IS NOT NULL
     AND t.aca_student_id IS NOT NULL
   GROUP BY t.class_date
   ORDER BY t.class_date;
$$;

COMMENT ON FUNCTION public.crm_class_session_dates IS
  '강좌 1개의 수업일(회차) 목록 + 회차별 인원수. 0118. "강좌 클릭 → 회차 클릭" 드롭다운용
  경량 조회 — 학생 메타는 반환하지 않는다. 분원 격리는 crm_classes 의 RLS 가 담당.';

COMMIT;
