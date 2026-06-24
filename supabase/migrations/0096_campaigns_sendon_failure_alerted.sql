-- ============================================================================
-- 0096_campaigns_sendon_failure_alerted.sql
-- 캠페인 발송 실패 Slack 알림 dedup 플래그.
-- ============================================================================
--
-- [의도]
--   발송 실패를 Slack 으로 알릴 때, 같은 캠페인을 반복 알림하지 않도록 "이미
--   알렸음" 시각을 캠페인에 기록한다. 두 경로가 이 컬럼을 공유한다:
--     1) 발송 시점 실패  — drain 이 캠페인을 마감할 때 우리 DB 에 '실패' 가 있으면.
--     2) sendon 비동기 실패 — 30분 주기 cron 이 sendon 측 실제 결과를 대조해
--        '발송됨' 인데 sendon 에서 실패(포인트 부족 등)한 건을 발견하면.
--   둘 중 먼저 감지한 쪽이 알림 + 이 컬럼 set → 다른 쪽은 건너뛴다(캠페인당 1회).
--
-- [동작]
--   - NULL (기본): 아직 실패 알림 안 보냄. cron 이 점검 대상으로 삼는다.
--   - 타임스탬프  : 그 시각에 실패를 알렸음. cron 은 더 이상 알리지 않는다.
-- ============================================================================

ALTER TABLE public.crm_campaigns
  ADD COLUMN IF NOT EXISTS sendon_failure_alerted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.crm_campaigns.sendon_failure_alerted_at IS
  '발송 실패를 Slack 으로 알린 시각. NULL 이면 미알림(cron 점검 대상). 캠페인당 1회 알림 dedup 용 — 발송시점 실패와 sendon 비동기 실패 두 경로가 공유.';
