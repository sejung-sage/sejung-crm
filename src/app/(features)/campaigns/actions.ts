"use server";

/**
 * F3 Part B · 캠페인 Server Actions
 *
 * 노출 액션:
 *   - resendFailedAction(campaignId): 캠페인 내 실패 메시지만 재발송.
 *   - resendSingleMessageAction(messageId): 특정 학생 1명(메시지 1건)만 재발송.
 *   - resumeStuckCampaignAction(campaignId): '발송중' 상태에서 자가호출 chain 이
 *     끊겨 멈춘 캠페인을 수동 재개.
 *   - cancelScheduledCampaignAction(campaignId): 예약 발송을 발송 전 취소.
 *
 * 정책:
 *   - dev-seed 모드 차단 (각 lib 함수 내부에서도 한 번 더 검사).
 *   - 권한은 lib 함수 내부에서 본 분원 send 권한 검사.
 */

import { revalidatePath } from "next/cache";
import { resendFailedMessages } from "@/lib/messaging/resend-failed";
import { resendSingleMessage } from "@/lib/messaging/resend-single";
import {
  resumeStuckCampaign,
  type ResumeStuckResult,
} from "@/lib/messaging/resume-stuck-campaign";
import {
  cancelScheduledCampaign,
  type CancelScheduledResult,
} from "@/lib/messaging/cancel-scheduled-campaign";
import {
  rescheduleCampaign,
  type RescheduleResult,
} from "@/lib/messaging/reschedule-campaign";
import {
  deleteCampaign,
  type DeleteCampaignResult,
} from "@/lib/campaigns/delete-campaign";
import {
  inspectCampaignSendon,
  type InspectCampaignResult,
} from "@/lib/messaging/inspect-campaign-sendon";
import {
  resendScheduledCampaign,
  type ResendScheduledResult,
} from "@/lib/messaging/resend-scheduled-campaign";
import { getCurrentUser } from "@/lib/auth/current-user";
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

export async function cancelScheduledCampaignAction(
  campaignId: string,
): Promise<CancelScheduledResult> {
  if (typeof campaignId !== "string" || campaignId.length === 0) {
    return { status: "failed", reason: "캠페인 ID 가 유효하지 않습니다" };
  }
  const result = await cancelScheduledCampaign(campaignId);
  if (result.status === "cancelled") {
    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath("/campaigns");
  }
  return result;
}

export async function rescheduleCampaignAction(
  campaignId: string,
  scheduledAt: string,
): Promise<RescheduleResult> {
  if (typeof campaignId !== "string" || campaignId.length === 0) {
    return { status: "failed", reason: "캠페인 ID 가 유효하지 않습니다" };
  }
  if (typeof scheduledAt !== "string" || scheduledAt.length === 0) {
    return { status: "failed", reason: "예약 시각이 비어 있습니다" };
  }
  const result = await rescheduleCampaign(campaignId, scheduledAt);
  if (result.status === "rescheduled") {
    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath("/campaigns");
  }
  return result;
}

export async function inspectCampaignSendonAction(
  campaignId: string,
): Promise<InspectCampaignResult> {
  if (typeof campaignId !== "string" || campaignId.length === 0) {
    return { status: "failed", reason: "캠페인 ID 가 유효하지 않습니다" };
  }
  // sendon 실제 상태 조회는 master 전용(외부 API 호출 + 전사 관점 점검 도구).
  const user = await getCurrentUser();
  if (!user) {
    return { status: "failed", reason: "로그인 후 이용 가능합니다" };
  }
  if (user.role !== "master") {
    return { status: "failed", reason: "마스터 계정만 조회할 수 있습니다" };
  }
  return await inspectCampaignSendon(campaignId);
}

export async function resendScheduledCampaignAction(
  campaignId: string,
): Promise<ResendScheduledResult> {
  if (typeof campaignId !== "string" || campaignId.length === 0) {
    return { status: "failed", reason: "캠페인 ID 가 유효하지 않습니다" };
  }
  const result = await resendScheduledCampaign(campaignId);
  if (result.status === "resent") {
    revalidatePath(`/campaigns/${campaignId}`);
    revalidatePath("/campaigns");
  }
  return result;
}

export async function deleteCampaignAction(
  campaignId: string,
): Promise<DeleteCampaignResult> {
  if (typeof campaignId !== "string" || campaignId.length === 0) {
    return { status: "failed", reason: "캠페인 ID 가 유효하지 않습니다" };
  }
  const result = await deleteCampaign(campaignId);
  if (result.status === "deleted") {
    revalidatePath("/campaigns");
  }
  return result;
}
