-- ============================================================
-- 0111_users_profile_sender_division.sql
-- 계정 프로필에 발신 명의(sender_division) 고정 축 추가.
-- ------------------------------------------------------------
-- 배경 (2026-07-15):
--   대치분원은 같은 학생 DB·같은 sendon 계정으로 두 발신 명의를 쓴다:
--   "세정학원"(본원) / "세정학원 수학관"(수학관). 0110 에서 캠페인에
--   sender_division(발송 시점 명의 기록)을 추가했고, 이번엔 계정마다
--   발신 명의를 미리 지정해 문자 발송 명의를 그 값으로 '고정(잠금)'한다.
--   대치 스태프 계정은 자기 sender_division 으로만 발송하고,
--   마스터 계정만 예외로 발송 시점에 본원/수학관을 선택할 수 있다.
--
--   branch(자유 TEXT)·crm_campaigns.sender_division 과 일관되게 자유 TEXT 로
--   두고 CHECK 를 걸지 않는다(확장성). 애플리케이션이 config/divisions.ts 로
--   선택지·검증을 통제한다. NULL = 본원 기본(기존 계정 회귀 없음).
--   인덱스 불필요(계정 수 소량, 계정별 단건 조회).
--
-- 롤백: ALTER TABLE public.crm_users_profile DROP COLUMN IF EXISTS sender_division;
-- ============================================================

BEGIN;

ALTER TABLE public.crm_users_profile
  ADD COLUMN IF NOT EXISTS sender_division TEXT;

COMMENT ON COLUMN public.crm_users_profile.sender_division IS
  '계정 발신 명의(본원/수학관 등). NULL=본원. 대치 분원 계정만 의미 — 이 값으로 문자 발송 명의가 고정된다(마스터는 예외로 발송 시 선택 가능).';

COMMIT;

-- ============================================================
-- ROLLBACK (수동):
-- ALTER TABLE public.crm_users_profile DROP COLUMN IF EXISTS sender_division;
-- ============================================================
