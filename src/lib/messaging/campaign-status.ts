/**
 * 세정학원 CRM · 캠페인 상태 머신
 *
 * 캠페인 상태 라이프사이클
 *
 *   임시저장 → 예약됨 (scheduled_at 설정 시)
 *   임시저장 → 발송중 (즉시 발송 시작)
 *   예약됨   → 발송중 (cron / 수동 트리거)
 *   발송중   → 완료 (전체 도달)
 *   발송중   → 실패 (전체 실패) — 부분 실패는 '완료' 유지하고
 *                                   messages.failed_count 로 표현
 *   임시저장/예약됨 → 취소 (사용자 취소)
 *
 * 부분 실패는 '완료' 상태에 failed_count 로 표현.
 * UI 의 캠페인 상세에서 "실패 건만 재발송" 버튼으로 messages.is_test=FALSE
 * 인 실패 행을 어댑터에 재호출하여 처리.
 *
 * backend 에서 status 변경 시 canTransition() 으로 사전 검증할 것.
 */

import type { CampaignStatus } from "@/types/database";

export type { CampaignStatus };

/**
 * 각 상태에서 전이 가능한 다음 상태들.
 * 종착(완료/실패/취소)에서 더 이상 전이 없음.
 */
export const CAMPAIGN_STATUS_TRANSITIONS: Record<
  CampaignStatus,
  CampaignStatus[]
> = {
  임시저장: ["예약됨", "발송중", "취소"],
  예약됨: ["발송중", "취소"],
  발송중: ["완료", "실패"],
  완료: [],
  실패: [],
  취소: [],
};

/**
 * from → to 전이가 정책상 허용되는지 검사.
 * backend status update 직전 호출하여 잘못된 전이를 차단한다.
 */
export function canTransition(
  from: CampaignStatus,
  to: CampaignStatus,
): boolean {
  return CAMPAIGN_STATUS_TRANSITIONS[from].includes(to);
}
