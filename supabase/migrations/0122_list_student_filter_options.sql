-- ============================================================
-- 0122_list_student_filter_options.sql
-- 학생 명단 필터 옵션(학교·학년·학교급 칩)을 distinct RPC 한 방으로.
-- ------------------------------------------------------------
-- 배경 (2026-08-20 현장 제보 — "발송 대상을 찾지를 못한다"):
--   list-filter-options.ts 는 crm_students 를 PostgREST 로 1,000행씩 페이지네이션
--   하며 distinct 를 애플리케이션 메모리에서 모았다. 안전상한이 MAX_PAGES=10 이라
--   실제로는 **상위 10,000행만** 훑고 끊긴다.
--
--   대치 분원 실측(탈퇴 제외 65,570명):
--     실제 distinct 학교 2,393개 → 칩에 노출 999개 → **1,394개 누락**
--     (누락 예: 상현고 22명, 송파중 18명, 양명여고 18명, 상암고 16명 …)
--
--   게다가 ORDER BY 가 없어 페이지 경계가 비결정적이다. 같은 필터로 새로고침할
--   때마다 노출되는 학교 집합이 바뀐다 → 운영자가 "아까는 있었는데 없다" 를 겪는다.
--
-- 해결:
--   DISTINCT 를 SQL 로 내린다. 왕복 10회(순차) → 1회, 스캔 범위는 상한 없이 전체.
--   반환은 배열 3개 한 행 — 학생 행을 앱까지 실어 나르지 않으므로 페이로드도 작다.
--
-- 왜 p_include_hidden 이 아니라 p_hidden_grades 인가:
--   숨김 학년('졸업','미정') 목록의 단일 소스는 TS 의 HIDDEN_GRADES_BY_DEFAULT
--   (src/lib/schemas/common.ts) 다. SQL 에 같은 리터럴을 또 박으면 두 곳이
--   갈라진다. 호출부가 그 상수를 그대로 넘기게 해 단일 소스를 유지한다.
--   NULL 또는 빈 배열 = 숨김 없음(includeHidden=true 와 동치).
--
-- 필터 정책 (호출부와 동일 — 자기 자신 좁힘 방지):
--   branch / statuses / hidden_grades 만 적용한다. grades·school_levels·regions 는
--   **적용하지 않는다** — 그 칩의 선택지를 구하는 쿼리에 그 칩 자신을 걸면
--   한 번 고른 뒤로는 다른 값을 못 고르게 된다.
--
-- 권한:
--   호출부(list-filter-options.ts)가 service client 전용이라 service_role 에만
--   EXECUTE 를 준다. 쿠키 의존이 없어 unstable_cache 와 호환되는 기존 구조 유지.
--
-- 롤백: 본 파일 하단 ROLLBACK 블록 참조 (함수만 DROP — 호출부가 페이지네이션
--       스캔으로 되돌아가야 하므로 코드 롤백과 함께 수행할 것).
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.list_student_filter_options(
  p_branch text DEFAULT NULL,
  p_statuses text[] DEFAULT NULL,
  p_hidden_grades text[] DEFAULT NULL
)
RETURNS TABLE(
  schools text[],
  grades text[],
  school_levels text[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      btrim(s.school)      AS school,
      s.grade::text        AS grade,
      s.school_level::text AS school_level
    FROM public.crm_students s
    WHERE s.status::text <> '탈퇴'
      AND (p_branch IS NULL OR s.branch = p_branch)
      AND (
        p_statuses IS NULL
        OR array_length(p_statuses, 1) IS NULL
        OR s.status::text = ANY (p_statuses)
      )
      AND (
        p_hidden_grades IS NULL
        OR array_length(p_hidden_grades, 1) IS NULL
        OR s.grade IS NULL
        OR s.grade::text <> ALL (p_hidden_grades)
      )
  )
  SELECT
    COALESCE(
      array_agg(DISTINCT b.school)
        FILTER (WHERE b.school IS NOT NULL AND b.school <> ''),
      '{}'::text[]
    ),
    COALESCE(
      array_agg(DISTINCT b.grade) FILTER (WHERE b.grade IS NOT NULL),
      '{}'::text[]
    ),
    COALESCE(
      array_agg(DISTINCT b.school_level)
        FILTER (WHERE b.school_level IS NOT NULL),
      '{}'::text[]
    )
  FROM base b;
$$;

COMMENT ON FUNCTION public.list_student_filter_options(text, text[], text[]) IS
  '학생 명단 필터 칩(학교·학년·학교급)의 선택지를 distinct 로 한 번에 반환하는 RPC. crm_students 베이스, 탈퇴 제외 + branch/statuses/hidden_grades 만 적용(칩 자기 자신 좁힘 방지). 기존 앱 측 1,000행 x 10페이지 스캔이 상위 10,000행에서 끊겨 대치 학교 2,393개 중 999개만 노출되던 버그를 해소(0122). service_role 전용.';

GRANT EXECUTE ON FUNCTION
  public.list_student_filter_options(text, text[], text[]) TO service_role;

COMMIT;

-- ============================================================
-- ROLLBACK (수동):
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.list_student_filter_options(text, text[], text[]);
-- COMMIT;
-- ※ 호출부(src/lib/profile/list-filter-options.ts)도 함께 되돌려야 한다.
--   RPC 만 지우면 필터 칩이 빈 목록으로 떨어진다.
-- ============================================================
