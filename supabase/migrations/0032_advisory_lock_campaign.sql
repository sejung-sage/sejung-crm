-- ============================================================
-- 0032_advisory_lock_campaign.sql
-- 캠페인 단위 advisory lock RPC 두 개.
--
-- 배경:
--   0031 sweep_stalled_campaigns 도입 후 drain 동시성 윈도우 발생.
--   - 어떤 청크가 3분 이상 걸리면 sweep 이 새 drain 인스턴스를 띄움.
--   - 원래 self-invocation drain 이 아직 살아 있다면 두 인스턴스가
--     같은 fetchPending(1000) 결과를 동시에 잡아 sendon 에 같은 메시지를
--     2번 발송할 수 있다.
--
-- 해법:
--   drainCampaignChunk 진입부에서 캠페인 단위 advisory lock 시도.
--   이미 다른 인스턴스가 점유 중이면 즉시 종료(hasMore=true 로 반환해서
--   self-invocation 또는 다음 sweep cycle 이 다시 잡도록).
--
-- ★ PostgREST 연결 풀 한계 (운영자 인지 필수) ★
--   - supabase-js 의 RPC 호출은 PostgREST 를 거친 짧은 트랜잭션이고,
--     각 호출이 같은 PG connection 을 재사용한다는 보장이 없다.
--   - pg_advisory_lock 은 connection(=session) 단위라
--     try_lock 한 connection 과 unlock 호출하는 connection 이 다를 수 있다.
--   - 이 경우:
--     * try_lock_campaign 이 false 를 반환할 수 있다 (이전 락 잔존)
--       → drain 인스턴스가 락 못 잡고 종료. sweep 이 다음 3분 cycle 에
--         다시 시도. **이건 안전한 fail-mode** — 이중 발송보다 한 cycle
--         더 기다리는 게 훨씬 낫다.
--     * 락이 잡힌 connection 이 풀에서 idle 종료/recycle 되면 자동 해제 →
--       영구 데드락 위험 없음.
--   - 강한 원자성이 필요하면 messages 를 FOR UPDATE SKIP LOCKED 로 가져오는
--     RPC 패턴으로 이전 (Phase 1).
--
-- 키 도출:
--   uuid → bigint 해시. hashtextextended('uuid-string', 0) 사용.
--   동일한 캠페인 ID 는 항상 동일한 키를 만들도록 STABLE.
--
-- 함수:
--   try_lock_campaign(p_campaign_id uuid)  RETURNS boolean
--     - 락 획득 성공 시 true. 이미 잡힌 상태면 false.
--   unlock_campaign(p_campaign_id uuid)    RETURNS boolean
--     - 같은 connection 이 락을 잡았던 경우 true 반환하며 해제.
--     - 다른 connection 에서 호출되면 false (PostgREST 풀에서는 흔함).
--       → 호출자는 false 라도 무시. connection idle 종료 시 자동 해제됨.
--
-- ROLLBACK 계획:
--   BEGIN;
--     DROP FUNCTION IF EXISTS public.try_lock_campaign(uuid);
--     DROP FUNCTION IF EXISTS public.unlock_campaign(uuid);
--   COMMIT;
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) try_lock_campaign
--    캠페인 단위 advisory lock 획득 시도. 비차단(try).
--    반환: true = 락 획득, false = 다른 connection 이 점유 중
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.try_lock_campaign(
  p_campaign_id uuid
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  -- hashtextextended(text, seed) → bigint. 같은 입력은 항상 같은 키.
  SELECT pg_try_advisory_lock(
    hashtextextended(p_campaign_id::text, 0)
  );
$$;

COMMENT ON FUNCTION public.try_lock_campaign(uuid) IS
  '캠페인 ID 해시를 키로 pg_try_advisory_lock 을 시도. '
  'true = 락 획득 성공, false = 다른 connection 이 이미 점유 중. '
  'drainCampaignChunk 진입부에서 호출 — false 면 즉시 종료해 이중 발송 방지.';


-- ------------------------------------------------------------
-- 2) unlock_campaign
--    캠페인 단위 advisory lock 해제.
--    같은 connection 에서 try_lock 했던 경우에만 true 반환.
--    PostgREST 풀에서는 다른 connection 이 호출될 수 있어 false 가 흔함 —
--    호출자는 false 를 무시하고 idle 종료 시 자동 해제에 의존.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unlock_campaign(
  p_campaign_id uuid
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_advisory_unlock(
    hashtextextended(p_campaign_id::text, 0)
  );
$$;

COMMENT ON FUNCTION public.unlock_campaign(uuid) IS
  '캠페인 ID 해시를 키로 pg_advisory_unlock 호출. '
  'try_lock 한 동일 connection 에서 호출되면 true, 다른 connection 이면 false. '
  'drainCampaignChunk 종료 시 try/finally 로 호출 — false 라도 무시 (idle 종료 시 자동 해제).';


-- ------------------------------------------------------------
-- 3) 권한
--    PostgREST 가 anon/authenticated 역할로 호출하지 못하도록 service_role 만 허용.
--    drain 라우트는 service client(secret key) 로만 호출하므로 service_role 만 있으면 충분.
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION public.try_lock_campaign(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unlock_campaign(uuid)   FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.try_lock_campaign(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.unlock_campaign(uuid)   TO service_role;

COMMIT;
