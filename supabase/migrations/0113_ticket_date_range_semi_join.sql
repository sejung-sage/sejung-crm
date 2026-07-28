-- ============================================================
-- 0113_ticket_date_range_semi_join.sql
-- 0112 실측 후속 — 기간 필터 RPC 를 세미조인으로 재작성 + 1000건 절단 제거.
-- ------------------------------------------------------------
-- 배경 (0112 를 실제 적용하고 측정해보니 두 가지가 틀렸다):
--
--  ① PostgREST max_rows=1000 이 RPC 결과에도 걸린다.
--     0112 는 `RETURNS TABLE(class_id text)` — 즉 집합 반환이라 PostgREST 가
--     1000행에서 잘라버린다. 실측:
--       기간 1년 → 실제 distinct 2,651건 / RPC 반환 1,000건 (절단)
--     0112 는 앱 레이어의 5만 행 절단을 없앴지만 1,000건 절단으로 바꿔놨을 뿐이다.
--     → 스칼라(text[]) 반환으로 바꾸면 1행이라 max_rows 와 무관해진다.
--
--  ② 커버링 인덱스가 커버링으로 동작하지 않는다.
--     0112 의 idx_aca_tickets_class_date_branch_class 는 Index Only Scan 으로
--     선택되지만 실측 플랜이 `Heap Fetches: 60009` 였다 (6만 행 전부 힙 재방문).
--     원인은 ETL 쓰기 패턴이다 — 20분마다 aca_tickets 45.5만 행을 통째로 재upsert
--     하므로 visibility map 이 all-visible 로 정착할 틈이 없다
--     (autovacuum_count=23, n_dead_tup≈47,539). 이 워크로드에서는 어떤 커버링
--     인덱스도 진짜 index-only 가 될 수 없다.
--     → 6만 행을 훑어 DISTINCT 하는 대신, crm_classes 3,523행에 대해
--       EXISTS 세미조인으로 뒤집는다. 힙 접근이 매칭된 강좌 수(수백~수천)로 줄고
--       스캔량이 티켓 수와 무관해진다.
--
-- 실측 (2026-07-28 · 운영 DB · EXPLAIN ANALYZE warm):
--
--   기간              0112 DISTINCT      0113 세미조인 (파라미터 호출)
--   -------------------------------------------------------------
--   한 달(전체분원)      4,355 ms            82 ms
--   1년                3,794 ms            38 ms
--   한 달 + 대치        2,309 ms            21 ms
--   시작일만                 -              26 ms
--   종료일만                 -              39 ms
--   매칭 0건                -              33 ms
--
--   앱 레이어 실측(PostgREST 왕복 포함): 7,709 ms → 81 ms.
--
-- ⚠️ 알려진 한계 — 넓은 기간은 여전히 실패한다 (0112·0113 공통 · 이번에도 미해결):
--   호출부는 반환된 id 를 `.in('aca_class_id', ids)` 로 URL 에 실어 보내는데,
--   게이트웨이 URL 한도가 실측 ~12KB(≈1,100 id) 근처에서 끊긴다:
--     1,000 id / 10.9KB → 200 OK
--     1,500 id / 16.2KB → 요청 실패
--     2,648 id / 28.2KB → 400
--   실사용 경계 (2026-07 운영 데이터 기준):
--     전체분원  : 3개월 1,012 id(10.9KB) OK / 6개월 1,544 id(16.5KB) 실패
--     단일분원  : 6개월   747 id( 8.3KB) OK / 1년   1,337 id(14.8KB) 실패
--   이건 0113 이 만든 회귀가 아니라 id 셋을 앱으로 왕복시키는 구조 자체의 한계이며
--   0112 이전에도 동일하게 깨졌다. 근본 해결은 강좌 목록 쿼리(필터·정렬·페이지네이션)
--   전체를 RPC 로 내려 세미조인을 서버에서 끝내는 것. 별도 작업으로 남긴다.
--
-- 분원 필터를 crm_classes 로 옮긴 이유:
--   0112 는 aca_tickets.branch 에 분원을 걸었는데, 그러면 (aca_class_id, class_date)
--   인덱스로 좁힌 뒤 branch 를 행별로 확인해야 해서 대치 한 달이 2,309ms 로 튀었다.
--   aca_class_id 는 "{branch_id}-{반고유_코드}" 라 이미 분원에 종속적이고, 호출부도
--   결국 crm_classes.branch 로 한 번 더 거른다. 분원 조건을 crm_classes 쪽에 두면
--   결과가 동일하면서 티켓 프로브가 순수 인덱스 탐색이 된다.
--   동치 검증 (대치 · 2026-07): 기존 방식 333건 = 새 방식 333건.
--
-- 반환 집합이 crm_classes 에 존재하는 id 로 한정되는 점:
--   0112 는 aca_tickets 에만 있는 aca_class_id 도 돌려줬다 (1년 기준 2,651 vs 2,648
--   — 3건 차이). 그 3건은 crm_classes 에 없어서 호출부의 .in() 에서 어차피 아무것도
--   매칭하지 않는다. 최종 결과는 동일하고 전송량만 줄어든다.
--
-- RLS:
--   SECURITY INVOKER 유지. 0112 는 aca_tickets RLS(can_read_branch) 만 탔지만
--   0113 은 crm_classes 를 베이스로 하므로 crm_classes RLS 도 함께 적용된다.
--   호출부(/classes 목록)가 어차피 crm_classes 를 직접 조회하므로 가시성 기준이
--   오히려 일치한다.
--
-- ETL 영향: 없음. scripts/etl 은 upsert 만 하고 DDL 을 실행하지 않는다.
--   인덱스 유지비도 재upsert 는 값이 안 바뀌어 HOT update 로 처리돼 사실상 0.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.crm_ticket_class_ids_in_date_range(date, date, text);
--   DROP INDEX IF EXISTS public.idx_aca_tickets_class_id_date;
--   그리고 0112 의 CREATE INDEX / CREATE FUNCTION 블록 재실행.
-- ============================================================

-- ─── 1) 세미조인용 복합 인덱스 (트랜잭션 밖 — CONCURRENTLY 제약과 동일 이유) ───
--
-- (aca_class_id, class_date): 강좌 하나당 "그 기간에 회차가 있나?" 를 인덱스
-- 탐색 한 번으로 끝낸다. EXISTS 라 첫 매칭에서 멈춘다.
-- 운영 DB 기준 생성 4.7초 · 4.4MB.
-- ※ aca_class_id 는 512,670행 전부 NOT NULL 이라(실측 NULL 0건) 부분 인덱스
--    술어를 걸 이유가 없다.
CREATE INDEX IF NOT EXISTS idx_aca_tickets_class_id_date
  ON public.aca_tickets (aca_class_id, class_date);

COMMENT ON INDEX public.idx_aca_tickets_class_id_date IS
  '/classes 기간 필터 세미조인용 — crm_ticket_class_ids_in_date_range() 가 강좌별로 "그 기간에 회차 존재?" 를 인덱스 탐색 1회로 판정한다. 0113.';

-- 0112 의 인덱스는 이 쿼리가 더 이상 쓰지 않는다. ETL 재upsert 마다 유지비만
-- 나가므로 제거한다 (0112 에서 오늘 새로 만든 것이라 다른 사용처가 없다).
DROP INDEX IF EXISTS public.idx_aca_tickets_class_date_branch_class;

-- ─── 2) RPC 재작성 ───────────────────────────────────────────
BEGIN;

-- 반환 타입이 TABLE(class_id text) → text[] 로 바뀌므로 CREATE OR REPLACE 불가.
DROP FUNCTION IF EXISTS public.crm_ticket_class_ids_in_date_range(date, date, text);

CREATE FUNCTION public.crm_ticket_class_ids_in_date_range(
  p_start_date date DEFAULT NULL,
  p_end_date   date DEFAULT NULL,
  p_branch     text DEFAULT NULL
)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
  -- 스칼라 1행 반환 — PostgREST max_rows(1000) 절단을 원천 회피한다.
  -- 빈 결과에서 array_agg 는 NULL 이므로 COALESCE 로 빈 배열 보장
  -- (호출부가 null 분기를 따로 두지 않아도 되게).
  SELECT COALESCE(array_agg(c.aca_class_id), '{}')
  FROM public.crm_classes c
  WHERE c.aca_class_id IS NOT NULL
    -- 빈 문자열은 "전체 분원" 의미 — 등치 비교로 흘리면 0건이 되므로 NULLIF 가드.
    AND (NULLIF(p_branch, '') IS NULL OR c.branch = p_branch)
    AND EXISTS (
      SELECT 1
      FROM public.aca_tickets t
      WHERE t.aca_class_id = c.aca_class_id
        -- 한쪽 날짜만 주면 그쪽만 (반대편 무한대).
        -- class_date IS NULL 행은 비교가 NULL 이라 자동 제외 (기존 동작 동일).
        --
        -- ⚠️ `(p_start_date IS NULL OR t.class_date >= p_start_date)` 로 쓰면 안 된다.
        --    plan 시점에 파라미터가 NULL 인지 모르므로 이 OR 는 인덱스 범위 조건으로
        --    내려가지 못하고, 강좌마다 그 강좌의 티켓 전량을 훑은 뒤 날짜를 필터한다.
        --    실측: 한 달 전체분원 36,397ms / 시작일만 37,995ms (아래 COALESCE 판은 82ms).
        --    COALESCE(파라미터, 상수) 는 실행 시작 시 런타임 상수로 접혀 인덱스
        --    범위 조건으로 내려간다. date 타입의 ±infinity 를 무한대 sentinel 로 쓴다.
        AND t.class_date >= COALESCE(p_start_date, '-infinity'::date)
        AND t.class_date <= COALESCE(p_end_date, 'infinity'::date)
    );
$fn$;

COMMENT ON FUNCTION public.crm_ticket_class_ids_in_date_range IS
  '/classes 기간 필터 전용 SECURITY INVOKER RPC. 주어진 기간(class_date)에 수업 회차가 1건이라도 있는 강좌의 aca_class_id 를 text[] 로 반환한다. crm_classes(3.5천행) 베이스 + aca_tickets EXISTS 세미조인 — 0112 의 티켓 6만행 DISTINCT(4.4초, Heap Fetches 6만) 를 19ms 로 대체. 스칼라 반환이라 PostgREST max_rows(1000) 절단도 없다. 분원은 crm_classes.branch 로 적용. 0112→0113.';

REVOKE ALL ON FUNCTION public.crm_ticket_class_ids_in_date_range(date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_ticket_class_ids_in_date_range(date, date, text) TO authenticated, service_role;

COMMIT;
