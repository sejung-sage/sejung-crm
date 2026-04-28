"use server";

/**
 * F3 Part B · 캠페인 Server Actions
 *
 * 노출 액션:
 *   - resendFailedAction(campaignId): 캠페인 내 실패 메시지만 재발송.
 *
 * 정책:
 *   - dev-seed 모드 차단 (resendFailedMessages 내부에서도 한 번 더 검사).
 *   - 권한은 resendFailedMessages 내부에서 본 분원 send 권한 검사.
 *   - 결과 타입은 sendCampaign 과 동일(`SendCampaignResult`).
 */

import {
  resendFailedMessages,
} from "@/lib/messaging/resend-failed";
import type { SendCampaignResult } from "@/lib/messaging/send-campaign";

export async function resendFailedAction(
  campaignId: string,
): Promise<SendCampaignResult> {
  if (typeof campaignId !== "string" || campaignId.length === 0) {
    return { status: "failed", reason: "캠페인 ID 가 유효하지 않습니다" };
  }
  return await resendFailedMessages(campaignId);
}
