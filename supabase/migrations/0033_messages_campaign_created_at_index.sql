-- ============================================================
-- 0033_messages_campaign_created_at_index.sql
-- messages (campaign_id, created_at) 복합 인덱스 추가.
--
-- 배경:
--   listCampaignMessages 가 .eq("campaign_id", id).order("created_at") 패턴.
--   기존 인덱스:
--     - idx_messages_campaign_id (campaign_id)
--     - idx_messages_campaign_status (campaign_id, status)
--   created_at 정렬용 인덱스 부재로 60K 캠페인 상세 페이지 로드 시
--   "canceling statement due to statement timeout" (Supabase 기본 8초)
--   에 걸려 페이지 자체가 500 응답 (2026-05-13 60K 캠페인 직접 관측).
--
-- 해법:
--   (campaign_id, created_at DESC) 복합 인덱스. WHERE campaign_id=$ ORDER BY
--   created_at 패턴이 index-only scan 으로 즉시 처리됨.
--
-- 운영 적용:
--   본 마이그는 CREATE INDEX (non-concurrent). 60K row 짜리 테이블이라
--   30초 이내 완료. 트래픽 끊기는 운영 환경이면 CONCURRENTLY 옵션 고려.
--   Supabase Studio SQL Editor 에서도 동일 SQL 적용 가능.
-- ============================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_messages_campaign_created_at
  ON public.messages (campaign_id, created_at DESC);

COMMENT ON INDEX public.idx_messages_campaign_created_at IS
  'listCampaignMessages 의 (campaign_id, created_at) 정렬 패턴 가속용. '
  '60K row 짜리 캠페인 상세 페이지 로드 statement timeout 회피.';

NOTIFY pgrst, 'reload schema';

COMMIT;
