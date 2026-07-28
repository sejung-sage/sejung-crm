-- ============================================================
-- 0112_ticket_date_range_class_ids.sql
-- /classes 기간 필터 가속 — aca_tickets distinct 스캔을 DB 로 이관.
-- ------------------------------------------------------------
-- 배경 (2026-07-28 사용자 보고: "강좌에서 기간으로 조회할 때 렉이 심함"):
--   기간 필터는 crm_classes 가 아니라 aca_tickets(회차 티켓) 에서 "그 기간에
--   수업이 1건이라도 있는 강좌" 를 먼저 모으는 구조다
--   (src/lib/classes/list-classes.ts · fetchClassIdsInTicketDateRange).
--
--   그 수집을 앱 레이어에서 PostgREST 페이지네이션(.range) 으로 돌리다 보니:
--     - PostgREST max_rows=1000 → 1000행씩 순차 HTTP 왕복
--     - 2026-07 한 달 매칭 티켓 60,192행 → 왕복 50회 · 실측 7.7초
--     - 같은 스캔을 list-class-filter-options(강사 드롭다운) 가 별도 복붙 구현으로
--       한 번 더 수행 → 페이지 1회 로드에 DB 왕복 100회
--     - .range() 는 LIMIT/OFFSET 이라 뒤 페이지일수록 앞을 다 훑고 버림
--       (실측: offset 0 → 198ms / offset 49,000 → 4,553ms)
--     - 실제로 필요한 값은 distinct aca_class_id 763개뿐인데 6만 행을 전송
--
--   더 나쁜 건 정확성 버그다. 앱 루프에 MAX_PAGES=50 (5만 행) 상한이 있어
--   60,192행 중 1만 행 이상이 조용히 버려진다. 경고 로그도 안 남는다
--   (경고는 distinct 1만 초과 시에만 발동). 즉 기간을 한 달 넘게 잡으면
--   일부 강좌가 목록에서 그냥 사라진다.
--   추가로 그 루프는 ORDER BY 없이 OFFSET 페이징을 해서, 플랜이 바뀌면
--   페이지 간 행 중복·누락이 나도 이상하지 않은 코드다.
--
-- 해결:
--   1) SELECT DISTINCT 를 DB 에서 한 방에 끝내는 SECURITY INVOKER RPC
--      → 왕복 100회 → 2회(호출부 2곳 × 1회), 전송량 6만 행 → 763행,
--        5만 행 절단 버그·불안정 OFFSET 페이징 동시 소멸.
--   2) (class_date, branch, aca_class_id) 커버링 복합 인덱스
--      → 기존 인덱스는 (class_date) 단독 · (branch) 단독뿐이라 기간+분원을
--        같이 걸면 한쪽만 타고 나머지는 행별 필터 + aca_class_id 는 매번 힙 접근.
--        세 컬럼을 다 담으면 index-only scan 으로 힙을 안 본다.
--
-- SECURITY INVOKER 인 이유:
--   aca_tickets 는 RLS `aca_tickets_read_by_branch = can_read_branch(branch)` 로
--   분원 가시성을 가른다(0054). INVOKER 라야 호출자 RLS 가 그대로 적용돼
--   현행 동작이 한 치도 안 바뀐다. DEFINER 로 두면 분원 격리가 뚫린다.
--
-- 반환 규모 한계 (알려진 잔여 제약 · 이번 범위 밖):
--   호출부는 반환된 id 들을 PostgREST `.in('aca_class_id', ids)` 로 넘긴다.
--   실측 763개 ≈ URL 8KB. crm_classes 전체가 3,523건이라 아무리 넓게 잡아도
--   상한이 ~3.5천개 ≈ 37KB 인데, 이는 게이트웨이 URL 한도(통상 16KB) 를 넘을 수
--   있다. 즉 "몇 년" 단위 초광범위 기간은 여전히 실패 가능. 이번 마이그는 그
--   구조(id 셋을 앱으로 왕복) 자체는 건드리지 않는다 — 해결하려면 강좌 목록
--   쿼리 전체를 RPC 로 내려야 해서 변경 범위가 훨씬 커진다.
--
-- ETL 영향:
--   scripts/etl 은 supabase-py upsert 만 하고 DDL(TRUNCATE/DROP INDEX)은 전혀
--   실행하지 않으므로, 한 번 만든 인덱스·함수는 동기화가 몇 번을 돌아도 그대로
--   유지된다. ETL 쪽에 추가할 작업 없음. 다만 aca_tickets 에 유지할 인덱스가
--   6개 → 7개로 늘어 티켓 upsert 가 아주 소폭 느려진다 (512,638행 기준 무시 가능).
--
-- 적용 주의:
--   CREATE INDEX 는 SHARE 락이라 빌드 동안 aca_tickets 쓰기가 막힌다.
--   512,638행 기준 수 초. ETL 동기화가 안 도는 시간대에 적용 권장.
--   CONCURRENTLY 는 트랜잭션 안에서 못 쓰므로 인덱스는 BEGIN/COMMIT 밖에 둔다
--   (0046 과 동일 패턴).
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.crm_ticket_class_ids_in_date_range(date, date, text);
--   DROP INDEX IF EXISTS public.idx_aca_tickets_class_date_branch_class;
-- ============================================================

-- ─── 1) 커버링 복합 인덱스 (트랜잭션 밖 — 위 주석 참조) ───────────
--
-- 컬럼 순서 근거:
--   class_date 선두 = 기간 필터가 이 인덱스의 존재 이유이고, 항상 걸린다
--     (기간이 없으면 애초에 이 경로를 안 탄다). 범위 조건이라 선두에 둔다.
--   branch 2번째 = 선택적 등치 조건. 범위 컬럼 뒤라 인덱스 탐색을 더 좁히진
--     못하지만, 인덱스 안에 있어 힙 접근 없이 필터링된다.
--   aca_class_id 3번째 = 우리가 실제로 뽑는 유일한 값. 포함시켜야 index-only
--     scan 이 성립한다.
-- 부분 인덱스 조건: aca_class_id IS NULL 인 행은 어차피 결과에서 제외되므로
--   인덱스에서도 뺀다 (크기·유지비 절감).
CREATE INDEX IF NOT EXISTS idx_aca_tickets_class_date_branch_class
  ON public.aca_tickets (class_date, branch, aca_class_id)
  WHERE aca_class_id IS NOT NULL;

COMMENT ON INDEX public.idx_aca_tickets_class_date_branch_class IS
  '/classes 기간 필터용 커버링 복합 인덱스 — crm_ticket_class_ids_in_date_range() 가 index-only scan 으로 distinct aca_class_id 를 뽑는다. aca_class_id NULL 행은 결과에서 어차피 빠지므로 부분 인덱스로 제외. 0112.';

-- ─── 2) distinct 강좌 ID RPC ─────────────────────────────────
BEGIN;

CREATE OR REPLACE FUNCTION public.crm_ticket_class_ids_in_date_range(
  p_start_date date DEFAULT NULL,
  p_end_date   date DEFAULT NULL,
  p_branch     text DEFAULT NULL
)
RETURNS TABLE(class_id text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  -- 앱 레이어(fetchClassIdsInTicketDateRange) 의 WHERE 절과 1:1 동치.
  --   - 한쪽 날짜만 주면 그쪽만 (반대편 무한대)
  --   - class_date IS NULL 행은 날짜 비교가 NULL 이라 자동 제외 (기존 동작 동일)
  --   - p_branch 는 NULL 또는 빈 문자열이면 분원 미좁힘. 빈 문자열을 그냥 등치
  --     비교로 흘리면 매칭 0건이 되어 "전체 분원" 이 조용히 0건으로 바뀌므로
  --     NULLIF 로 방어한다 (호출부는 null 을 넘기지만 RPC 단에서도 안전하게).
  --   - 분원 좁힘이 없어도 RLS(can_read_branch) 가 가시 분원을 최종 결정한다.
  SELECT DISTINCT t.aca_class_id
  FROM public.aca_tickets t
  WHERE t.aca_class_id IS NOT NULL
    AND (p_start_date IS NULL OR t.class_date >= p_start_date)
    AND (p_end_date   IS NULL OR t.class_date <= p_end_date)
    AND (NULLIF(p_branch, '') IS NULL OR t.branch = p_branch);
$$;

COMMENT ON FUNCTION public.crm_ticket_class_ids_in_date_range IS
  '/classes 기간 필터 전용 SECURITY INVOKER RPC. 주어진 기간(class_date)에 수업 회차가 1건이라도 있는 강좌의 distinct aca_class_id 를 반환한다. 앱 레이어에서 aca_tickets 를 1000행씩 최대 50회 순차 왕복하던 것(2026-07 한 달=6만행·7.7초, 5만행 초과분 무단 절단)을 단일 쿼리로 대체. RLS aca_tickets_read_by_branch 가 그대로 적용되도록 INVOKER. 0112.';

-- 로그인 사용자만 호출 가능. 실제 행 가시성은 RLS 가 결정한다.
REVOKE ALL ON FUNCTION public.crm_ticket_class_ids_in_date_range(date, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_ticket_class_ids_in_date_range(date, date, text) TO authenticated, service_role;

COMMIT;
