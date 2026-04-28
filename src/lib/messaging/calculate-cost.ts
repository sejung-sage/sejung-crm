/**
 * F3 Part B · 메시지 발송 비용 계산.
 *
 * 솔라피 기준 단가 (`SOLAPI_UNIT_COST`) × 수신자 수.
 * 어댑터가 응답으로 cost 를 안 줄 가능성이 있어 자체 계산 결과를
 * 진실 소스로 사용한다(Compose 미리보기, campaigns.total_cost 합산).
 *
 * MMS 는 미지원 (cost-rates 에 정의 없음).
 *
 * 순수 함수. 외부 IO 없음.
 */

import { SOLAPI_UNIT_COST, type SmsCostBreakdown } from "./cost-rates";

export function calculateCost(
  type: "SMS" | "LMS" | "ALIMTALK",
  recipientCount: number,
): SmsCostBreakdown {
  if (recipientCount < 0 || !Number.isInteger(recipientCount)) {
    throw new Error("수신자 수는 0 이상의 정수여야 합니다");
  }
  const unitCost = SOLAPI_UNIT_COST[type];
  return {
    type,
    unitCost,
    recipientCount,
    totalCost: unitCost * recipientCount,
  };
}
