-- ============================================================================
-- 0097_campaigns_sendon_check_due.sql
-- 발송 후 sendon 실패 점검 예약 시각.
-- ============================================================================
--
-- [의도]
--   전체 폴링(0096 방식) 대신, 캠페인 발송/예약 접수가 끝난 시점에 "5분 뒤 점검"을
--   예약한다. sendon 비동기 실패(포인트 부족 등)는 접수 직후 잠시 뒤 찍히므로,
--   발송 직후가 아니라 약간의 지연을 두고 그 캠페인만 콕 집어 확인하기 위함.
--
-- [동작]
--   - drain 이 캠페인을 마감하면 sendon_check_due_at = now()+5분 으로 세팅.
--   - cron(짧은 주기)이 sendon_check_due_at <= now() 인 캠페인을 집어 점검 →
--     점검을 claim 하며 sendon_check_due_at = NULL 로 비운다(1회만 점검).
--   - 실패가 있으면 sendon_failure_alerted_at(0096) 를 찍고 Slack 1회 알림.
--   - NULL: 예약된 점검 없음(미발송/이미 점검함). 백필·전체 스캔 없음.
-- ============================================================================

ALTER TABLE public.crm_campaigns
  ADD COLUMN IF NOT EXISTS sendon_check_due_at TIMESTAMPTZ;

COMMENT ON COLUMN public.crm_campaigns.sendon_check_due_at IS
  '발송 완료 후 sendon 실패 점검 예정 시각(now()+5분). cron 이 이 시각 이후 1회 점검하고 NULL 로 비운다. NULL 이면 예약된 점검 없음.';
