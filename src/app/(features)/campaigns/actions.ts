"use server";

/**
 * F3 Part B · 캠페인 Server Actions
 *
 * 노출 액션:
 *   - resendFailedAction(campaignId): 캠페인 내 실패 메시지만 재발송.
 *   - resendSingleMessageAction(messageId): 특정 학생 1명(메시지 1건)만 재발송.
 *   - resumeStuckCampaignAction(campaignId): '발송중' 상태에서 자가호출 chain 이
 *     끊겨 멈춘 캠페인을 수동 재개.
 *
 * 정책:
 *   - dev-seed 모드 차단 (각 lib 함수 내부에서도 한 번 더 검사).
 *   - 권한은 lib 함수 내부에서 본 분원 send 권한 검사.
 */

import { resendFailedMessages } from "@/lib/messaging/resend-failed";
import { resendSingleMessage } from "@/lib/messaging/resend-single";
import {
  resumeStuckCampaign,
  type ResumeStuckResult,
} from "@/lib/messaging/resume-stuck-campaign";
import type { SendCampaignResult } from "@/lib/messaging/send-campaign";

export async function resendFailedAction(
  campaignId: string,
): Promise<SendCampaignResult> {
  if (typeof campaignId !== "string" || campaignId.length === 0) {
    return { status: "failed", reason: "캠페인 ID 가 유효하지 않습니다" };
  }
  return await resendFailedMessages(campaignId);
}

export async function resendSingleMessageAction(
  messageId: string,
): Promise<SendCampaignResult> {
  if (typeof messageId !== "string" || messageId.length === 0) {
    return { status: "failed", reason: "메시지 ID 가 유효하지 않습니다" };
  }
  return await resendSingleMessage(messageId);
}

export async function resumeStuckCampaignAction(
  campaignId: string,
): Promise<ResumeStuckResult> {
  if (typeof campaignId !== "string" || campaignId.length === 0) {
    return { status: "failed", reason: "캠페인 ID 가 유효하지 않습니다" };
  }
  return await resumeStuckCampaign(campaignId);
}
