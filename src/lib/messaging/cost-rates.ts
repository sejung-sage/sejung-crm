/**
 * 세정학원 CRM · 메시지 단가표
 *
 * 솔라피(1순위) 기준 1건당 비용(원).
 * 실제 단가가 변경되면 이 파일만 수정.
 *
 * MMS 는 이번 세션 미지원. 필요 시 추후 추가.
 *
 * 사용처:
 *  - src/lib/messaging/calculate-cost.ts (backend 가 구현)
 *  - 캠페인 미리보기 단계 예상 비용 표시
 *  - 캠페인 상세 총 비용 합산 (campaigns.total_cost)
 */
export const SOLAPI_UNIT_COST = {
  SMS: 8,
  LMS: 14,
  ALIMTALK: 13,
} as const;

export type SmsType = keyof typeof SOLAPI_UNIT_COST;

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
