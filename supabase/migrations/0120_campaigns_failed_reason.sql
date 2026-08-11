-- ============================================================
-- 0120_campaigns_failed_reason.sql
-- 캠페인 실패 사유(crm_campaigns.failed_reason) 보존.
-- ------------------------------------------------------------
-- 배경 (2026-08-11):
--   2026-08-10 19:55 '손나래T 영동고2 영어' 발송(125명)이 status='실패' 로 끝났는데,
--   왜 실패했는지 사후에 알 방법이 전혀 없었다.
--     - crm_campaigns 에 실패 사유 컬럼이 없어 DB 에 미기록
--     - 실패 경로에 console.error 가 없어 Vercel 로그에도 함수 출력 0건
--     - 사유 문자열은 발송 순간 화면 토스트에만 표시되고 사라짐
--   crm_messages 에는 이미 failed_reason 이 있지만, 이 건처럼 메시지 큐 적재 자체가
--   실패하면 메시지 행이 0건이라 건별 사유로도 커버되지 않는다.
--
-- 정책:
--   - status='실패' 로 전이시키는 모든 경로가 이 컬럼에 사유를 함께 기록한다
--     (send-campaign / drain-campaign / excel-send / 설명회 발송).
--   - 실패가 아닌 상태에서는 NULL. 재발송으로 '발송중' 복귀 시에도 갱신하지 않는다
--     (직전 실패 이력을 남겨두는 편이 운영 추적에 유리).
--   - 발송 내역 상세 화면이 이 값을 그대로 노출한다.
-- ============================================================

ALTER TABLE public.crm_campaigns
  ADD COLUMN IF NOT EXISTS failed_reason TEXT;

COMMENT ON COLUMN public.crm_campaigns.failed_reason IS
  '캠페인 실패 사유. status=''실패'' 로 전이시킨 경로가 기록한다(예: "메시지 큐 적재 실패: ...", "발신번호 환경변수가 설정되어 있지 않습니다"). 그 외 상태에서는 NULL. 건별 사유는 crm_messages.failed_reason 을 볼 것 — 큐 적재 전 실패는 메시지 행이 없어 이 컬럼이 유일한 단서다. 0120 추가.';
