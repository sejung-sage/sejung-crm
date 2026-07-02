-- ============================================================
-- 0105_campaign_failure_ack.sql
-- 발송 실패 앱 내 알림용: 캠페인 실패 '확인(dismiss)' 추적 컬럼.
-- ------------------------------------------------------------
-- 배경 (2026-07-02):
--   발송 실패 시 원장(사용자)에게 앱 내 상단 배너로 알린다. 모든 실패 경로
--   (동기 발송·드레인·예약 dispatch·크론)가 이미 crm_campaigns.status='실패'
--   로 표시하므로, status='실패' 행을 직접 읽어 배너에 띄우면 백그라운드
--   실패까지 별도 배선 없이 전부 커버된다. 남은 건 '확인했는지' 여부뿐.
--
--   failure_acknowledged_at:
--     NULL  = 미확인 → 배너에 노출
--     값     = 사용자가 '확인' 누른 시각 → 배너에서 제외
--
--   베이스라인: 이미 쌓인 과거 실패건이 배너에 한꺼번에 뜨지 않도록,
--   기존 status='실패' 행은 전부 '확인됨'(updated_at)으로 채운다.
--   → 마이그 적용 이후 새로 발생하는 실패만 배너에 노출된다.
--
-- 롤백:
--   DROP INDEX IF EXISTS public.idx_campaigns_unacked_failure;
--   ALTER TABLE public.crm_campaigns DROP COLUMN IF EXISTS failure_acknowledged_at;
-- ============================================================

BEGIN;

ALTER TABLE public.crm_campaigns
  ADD COLUMN IF NOT EXISTS failure_acknowledged_at timestamptz;

COMMENT ON COLUMN public.crm_campaigns.failure_acknowledged_at IS
  '발송 실패 앱 내 알림 확인(dismiss) 시각. NULL=미확인(배너 노출), 값=사용자 확인함. 0105.';

-- 베이스라인: 기존 실패건은 이미 인지된 것으로 보고 확인 처리(배너 초기 폭주 방지).
UPDATE public.crm_campaigns
  SET failure_acknowledged_at = COALESCE(updated_at, now())
  WHERE status = '실패'
    AND failure_acknowledged_at IS NULL;

-- 미확인 실패 조회 전용 부분 인덱스(배너 쿼리 최적화).
CREATE INDEX IF NOT EXISTS idx_campaigns_unacked_failure
  ON public.crm_campaigns (created_at DESC)
  WHERE status = '실패' AND failure_acknowledged_at IS NULL;

COMMIT;

-- ============================================================
-- ROLLBACK (수동):
-- DROP INDEX IF EXISTS public.idx_campaigns_unacked_failure;
-- ALTER TABLE public.crm_campaigns DROP COLUMN IF EXISTS failure_acknowledged_at;
-- ============================================================
