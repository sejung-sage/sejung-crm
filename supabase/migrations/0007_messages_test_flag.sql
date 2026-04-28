-- ============================================================
-- 0007_messages_test_flag.sql
-- 세정학원 CRM · F3 Part B · 테스트 발송 플래그 도입
--
-- 목적:
--   1) messages.is_test BOOLEAN 추가 — 테스트 발송 1건을 식별.
--      캠페인 통계(도달률·실패율·총 비용) 집계에서 제외하기 위함.
--   2) campaigns.is_test BOOLEAN 추가 — 테스트 발송 전용 캠페인을
--      리스트에서 별도 표시(필요 시) 가능하도록.
--
-- 정책 메모:
--   - 본 컬럼은 DEFAULT FALSE 이므로 기존 데이터는 모두 일반 발송으로 유지.
--   - is_test = TRUE 인 행은 backend 의 통계 쿼리에서 WHERE is_test = FALSE
--     로 걸러내야 한다 (집계 책임은 애플리케이션 레이어).
--   - 부분 인덱스는 데이터량이 적어 과잉. 일반 인덱스도 생략.
--
-- 롤백 메모 (수동):
--   ALTER TABLE public.messages DROP COLUMN IF EXISTS is_test;
--   ALTER TABLE public.campaigns DROP COLUMN IF EXISTS is_test;
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) messages.is_test
-- ------------------------------------------------------------
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.messages.is_test IS
  '테스트 발송 여부. TRUE 면 캠페인 통계·도달률·비용 합산에서 제외할 것.';


-- ------------------------------------------------------------
-- 2) campaigns.is_test
-- ------------------------------------------------------------
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.campaigns.is_test IS
  '테스트 발송용 캠페인. TRUE 면 캠페인 리스트에서 별도 표시 가능.';

COMMIT;
