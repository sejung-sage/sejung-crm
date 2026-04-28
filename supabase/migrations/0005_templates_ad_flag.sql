-- ============================================================
-- 0005_templates_ad_flag.sql
-- 세정학원 CRM · templates 에 광고 플래그 + 바이트 카운트 추가
-- ============================================================
--
-- 목적:
--   F3 발송 안전 가드 도입. is_ad 기준으로 [광고] prefix / 080 수신거부 /
--   야간 차단(21~08) 분기.
--
-- 변경 요약:
--   1) templates.is_ad        BOOLEAN NOT NULL DEFAULT FALSE
--      - 광고성 메시지 여부. TRUE 시 발송 단계에서 [광고] prefix,
--        080 수신거부 footer, 21시~08시 광고 차단 규칙이 자동 적용됨.
--      - 알림(시험·출결·결제 안내)용은 FALSE 로 둘 것.
--   2) templates.byte_count   INT NOT NULL DEFAULT 0
--      - 본문 EUC-KR 기준 바이트 수 (한글 2 / ASCII 1).
--      - SMS 90 / LMS 2000 / ALIMTALK 1000 바이트 제한 검증용.
--      - PG 내 EUC-KR 계산이 까다롭고 이식성이 낮아 generated column
--        을 쓰지 않음. 생성/수정 시 애플리케이션 레이어에서 계산해 저장.
--
-- 롤백 (필요 시 수동):
--   ALTER TABLE public.templates DROP COLUMN IF EXISTS byte_count;
--   ALTER TABLE public.templates DROP COLUMN IF EXISTS is_ad;
-- ============================================================

BEGIN;

ALTER TABLE public.templates
  ADD COLUMN IF NOT EXISTS is_ad BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.templates
  ADD COLUMN IF NOT EXISTS byte_count INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.templates.is_ad IS
  '광고성 여부. TRUE 면 발송 시 [광고] prefix + 080 수신거부 footer + 야간 차단 규칙이 적용됨. 알림 용도는 FALSE.';

COMMENT ON COLUMN public.templates.byte_count IS
  '본문 바이트(EUC-KR, 한글 2 / ASCII 1). 생성·수정 시 애플리케이션에서 계산해 저장.';

-- 광고성 템플릿만 모아보는 필터가 잦을 수 있어 보조 인덱스. 비용은 미미.
CREATE INDEX IF NOT EXISTS idx_templates_is_ad ON public.templates (is_ad);

COMMIT;
