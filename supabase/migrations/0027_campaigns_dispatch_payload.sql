-- ============================================================
-- 0027_campaigns_dispatch_payload.sql
-- campaigns 에 발송 payload 컬럼 추가 — 예약 발송 cron 디스패치 지원.
--
-- 배경:
--   기존 campaigns 테이블은 title / template_id / group_id / scheduled_at
--   만 저장. 즉시 발송에서는 input.body / subject / type / isAd 가 메모리
--   안에서 흘러가지만, 예약 발송은 cron 시점에 다시 발송 정보를 읽어야 한다.
--
--   해결책 두 가지:
--     A) template_id 필수화 (cron 시점에 template 에서 읽음)
--        → inline body 예약 발송 불가. 사용자 UX 제약 큼.
--     B) campaigns 에 발송 payload 영속화 (본 마이그)
--        → inline body / 템플릿 둘 다 예약 가능.
--
--   B 채택. 즉시 발송도 동일 컬럼 채워 두면 retry / 재발송 시 재현성 확보.
--
-- 변경:
--   - body          TEXT NULL — 발송 본문 (예약 시점 스냅샷)
--   - subject       TEXT NULL — LMS/알림톡 제목 (SMS 는 NULL)
--   - type          TEXT NULL CHECK ('SMS'/'LMS'/'ALIMTALK')
--   - is_ad         BOOLEAN DEFAULT FALSE — 광고성 여부 (가드 재적용)
--
--   기존 행은 모두 NULL 또는 default. 즉시 발송으로 만들어진 과거 캠페인은
--   본문 재현 불가지만 이미 발송된 상태라 영향 없음.
--
-- 안전성:
--   - 컬럼 추가만 (DROP 없음). NOT NULL 제약 없음 (기존 데이터 보호).
--   - CHECK 는 NULL 허용 형태로 추가.
--   - 마이그 멱등 (IF NOT EXISTS · IF EXISTS 사용).
--
-- 롤백 (수동):
--   ALTER TABLE public.campaigns
--     DROP COLUMN IF EXISTS body,
--     DROP COLUMN IF EXISTS subject,
--     DROP COLUMN IF EXISTS type,
--     DROP COLUMN IF EXISTS is_ad;
-- ============================================================

BEGIN;

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS body TEXT,
  ADD COLUMN IF NOT EXISTS subject TEXT,
  ADD COLUMN IF NOT EXISTS type TEXT,
  ADD COLUMN IF NOT EXISTS is_ad BOOLEAN NOT NULL DEFAULT FALSE;

-- type CHECK — NULL 허용 + 3종.
-- 기존 NULL 값을 깨지 않기 위해 IS NULL OR IN (...) 형태.
ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_type_check;
ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_type_check
  CHECK (type IS NULL OR type IN ('SMS', 'LMS', 'ALIMTALK'));

COMMENT ON COLUMN public.campaigns.body IS
  '발송 본문 스냅샷 (예약 발송 시 cron 디스패처가 다시 읽음). 즉시 발송도 보존.';
COMMENT ON COLUMN public.campaigns.subject IS
  'LMS/알림톡 제목 (SMS 는 NULL). 예약 발송 시 cron 이 사용.';
COMMENT ON COLUMN public.campaigns.type IS
  '발송 유형 (SMS/LMS/ALIMTALK). 예약 발송 시 cron 디스패치가 사용.';
COMMENT ON COLUMN public.campaigns.is_ad IS
  '광고성 여부. 예약 발송 시 cron 시점 야간 광고 가드 재적용에 사용.';

COMMIT;
