/**
 * 세정학원 CRM · 메시지 단가표
 *
 * sendon 기준 세정학원 전용 단가 (부가세 별도, 1건당 원).
 * 실제 단가가 변경되면 이 파일만 수정.
 *
 * 정상가 대비:
 *   - SMS  : 7.4원   (정상 10.5)
 *   - LMS  : 24원    (정상 32.4)
 *   - MMS  : 59.2원  (정상 75)   ← 컬럼 정의만 — 본 세션은 SMS/LMS/ALIMTALK 만 사용
 *   - 알림톡: 6.4원  (정상 7.8)
 *
 * 소수 단가 처리:
 *   - 본 상수는 float 그대로 유지 (정확한 사용자 표시·합산용).
 *   - DB(messages.cost / campaigns.total_cost) 는 INT 컬럼이라 storage 시점에
 *     `Math.round` 적용 — send-campaign / resend-failed / dispatch-scheduled 책임.
 *   - 합산 시 round 반복 누적이 정확도를 떨어뜨리므로 sum 단계까지 float 유지.
 *
 * 사용처:
 *  - src/lib/messaging/calculate-cost.ts
 *  - 캠페인 미리보기 단계 예상 비용 표시
 *  - 캠페인 상세 총 비용 합산 (campaigns.total_cost)
 */
export const SENDON_UNIT_COST = {
  SMS: 7.4,
  LMS: 24,
  ALIMTALK: 6.4,
} as const;

/**
 * MMS 단가 (참고용 — 현재 송출 파이프라인은 SMS/LMS/ALIMTALK 만 지원).
 * 활성화 시 SmsType 유니온 + 어댑터 분기 + UI/byte limit 동시 갱신 필요.
 */
export const SENDON_MMS_UNIT_COST = 59.2 as const;

export type SmsType = keyof typeof SENDON_UNIT_COST;

/**
 * 비용 산출 결과 통일 타입.
 * - unitCost: 1건당 비용 (원)
 * - recipientCount: 수신자 수
 * - totalCost: unitCost * recipientCount
 * - type: SMS / LMS / ALIMTALK
 */
export type SmsCostBreakdown = {
  unitCost: number;
  recipientCount: number;
  totalCost: number;
  type: SmsType;
};
