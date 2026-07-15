-- ============================================================
-- 0110_campaigns_sender_division.sql
-- 캠페인에 발신 division(발신 정체성) 축 추가.
-- ------------------------------------------------------------
-- 배경 (2026-07-15):
--   대치분원은 같은 학생 DB·같은 sendon 계정을 쓰면서도 두 발신 정체성으로
--   문자를 보낸다: "세정학원"(본원) / "세정학원 수학관"(수학관, 02-6265-1010).
--   branch 는 sendon 계정을 결정(기존 그대로), division 은 발신번호·표시 브랜드명을
--   결정하는 2축 모델. 향후 다른 분원의 수학관 등으로 확장 가능하다.
--
--   sender_division 은 branch(자유 TEXT)와 일관되게 자유 TEXT 로 두고 CHECK 를 걸지
--   않는다(확장성). 애플리케이션이 config/divisions.ts 로 선택지·검증을 통제한다.
--   NULL = 본원 기본 의미(기존 캠페인 회귀 없음).
--
-- 롤백: ALTER TABLE public.crm_campaigns DROP COLUMN IF EXISTS sender_division;
-- ============================================================

BEGIN;

ALTER TABLE public.crm_campaigns
  ADD COLUMN IF NOT EXISTS sender_division TEXT;

COMMENT ON COLUMN public.crm_campaigns.sender_division IS
  '발신 division(본원/수학관 등). NULL=본원 기본. 대치 수학관처럼 같은 분원 내 다른 발신번호·표시명 선택.';

COMMIT;

-- ============================================================
-- ROLLBACK (수동):
-- ALTER TABLE public.crm_campaigns DROP COLUMN IF EXISTS sender_division;
-- ============================================================
