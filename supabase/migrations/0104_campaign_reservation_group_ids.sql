-- ============================================================
-- 0104_campaign_reservation_group_ids.sql
-- 예약 취소용: 캠페인의 sendon 예약 groupId(=vendor_message_id) DISTINCT 조회 RPC.
-- ------------------------------------------------------------
-- 배경 (2026-07-02):
--   예약 취소(cancel-scheduled-campaign.ts)는 캠페인이 sendon 에 접수한 예약
--   groupId 를 모아 sms.cancel(groupId) 로 취소한다. 기존엔 crm_messages 를
--   `select(vendor_message_id)` 로 통째 읽었는데, PostgREST max_rows=1000 에 잘려
--   수신자 >1,000명 캠페인은 앞쪽 groupId 1~2개만 취소되고 나머지 예약은 그대로
--   발송되는 정확성 버그가 있었다(화면은 '취소'로 표시 → 발송 안전 위반).
--
--   groupId 는 batch(최대 1,000명)당 1개라 캠페인당 몇 개뿐이다. DISTINCT 로
--   뽑으면 반환 행이 ceil(수신자/1000) 로 작아 max_rows 에 걸리지 않고, 조회도
--   idx_messages_campaign_id 를 타 빠르다.
--
-- 롤백: DROP FUNCTION public.crm_campaign_reservation_group_ids(uuid);
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.crm_campaign_reservation_group_ids(
  p_campaign_id uuid   -- 대상 캠페인 ID
)
RETURNS TABLE(
  vendor_message_id text   -- sendon 예약 groupId (batch 단위, 중복 제거)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT m.vendor_message_id
  FROM public.crm_messages m
  WHERE m.campaign_id = p_campaign_id
    AND m.vendor_message_id IS NOT NULL;
$$;

COMMENT ON FUNCTION public.crm_campaign_reservation_group_ids(uuid) IS
  '예약 취소용: 캠페인이 sendon 에 접수한 예약 groupId(vendor_message_id) 를 DISTINCT 로 반환. '
  'max_rows(1000) 잘림 없이 전체 groupId 를 확보해 대형 예약도 완전 취소하기 위함. 0104.';

GRANT EXECUTE ON FUNCTION public.crm_campaign_reservation_group_ids(uuid) TO authenticated;

COMMIT;

-- ============================================================
-- ROLLBACK (수동):
-- DROP FUNCTION IF EXISTS public.crm_campaign_reservation_group_ids(uuid);
-- ============================================================
