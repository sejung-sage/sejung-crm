/**
 * 예약 발송 시각 변경 (취소 후 재예약).
 *
 * sendon 은 예약 시각 수정을 지원하지 않으므로, 기존 reservation 을 취소하고
 * 새 시각으로 다시 접수한다:
 *   1) 저장된 groupId(vendor_message_id)로 sendon 예약 취소
 *   2) 메시지를 '대기' 로 리셋(vendor_message_id 제거)
 *   3) 캠페인 scheduled_at 을 새 시각으로, status='발송중' 으로
 *   4) drain 재킥 → drain 이 새 scheduled_at 으로 sendon reservation 재접수 → '예약됨'
 *
 * 안전 가드: dev-seed 차단, 본 분원 send 권한, status='예약됨' 만, 새 시각 30분 이후.
 */

import { waitUntil } from "@vercel/functions";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/can";
import { getCampaign } from "@/lib/campaigns/get-campaign";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { createSmsAdapter } from "@/lib/messaging/adapters";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { getMessagingBaseUrl } from "./base-url";
import {
  SCHEDULE_MIN_LEAD_MS,
  SCHEDULE_MIN_LEAD_LABEL,
  SENDON_MIN_RESERVATION_MS,
} from "./schedule-window";

export type RescheduleResult =
  | { status: "rescheduled"; scheduledAt: string }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode"; reason: string };

export async function rescheduleCampaign(
  campaignId: string,
  newScheduledAtIso: string,
): Promise<RescheduleResult> {
  if (isDevSeedMode()) {
    return {
      status: "dev_seed_mode",
      reason: "개발 시드 모드에서는 예약 변경이 차단됩니다",
    };
  }
  if (!campaignId || typeof campaignId !== "string") {
    return { status: "failed", reason: "캠페인 ID 가 유효하지 않습니다" };
  }

  const newDate = new Date(newScheduledAtIso);
  if (Number.isNaN(newDate.getTime())) {
    return { status: "failed", reason: "예약 시각 형식이 올바르지 않습니다" };
  }
  if (newDate.getTime() < Date.now() + SCHEDULE_MIN_LEAD_MS) {
    return {
      status: "failed",
      reason: `예약 시각은 지금부터 최소 ${SCHEDULE_MIN_LEAD_LABEL} 이후여야 합니다`,
    };
  }
  // 자체 지연발송 여부 — 새 시각이 sendon 최소 예약(30분) 미만이면 cron 이 발송한다.
  const isSelfDelayed =
    newDate.getTime() - Date.now() < SENDON_MIN_RESERVATION_MS;

  const campaign = await getCampaign(campaignId);
  if (!campaign) {
    return { status: "failed", reason: "존재하지 않는 캠페인입니다" };
  }
  const user = await getCurrentUser();
  if (!user) {
    return { status: "failed", reason: "로그인 후 이용 가능합니다" };
  }
  if (!can(user, "send", "campaign", campaign.branch)) {
    return { status: "failed", reason: "본 분원 캠페인 발송 권한이 없습니다" };
  }
  if (campaign.status !== "예약됨") {
    return {
      status: "failed",
      reason: `예약 상태가 아니라 변경할 수 없습니다 (현재: ${campaign.status})`,
    };
  }

  const supabase = createSupabaseServiceClient();

  // 1) 기존 sendon 예약 취소.
  const { data: rows, error: readErr } = (await supabase
    .from("crm_messages")
    .select("vendor_message_id")
    .eq("campaign_id", campaignId)
    .not("vendor_message_id", "is", null)) as unknown as {
    data: { vendor_message_id: string | null }[] | null;
    error: { message: string } | null;
  };
  if (readErr) {
    return { status: "failed", reason: `예약 정보 조회 실패: ${readErr.message}` };
  }
  const groupIds = Array.from(
    new Set(
      (rows ?? [])
        .map((r) => r.vendor_message_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  );
  const adapter = createSmsAdapter(campaign.branch);
  for (const gid of groupIds) {
    const r = await adapter.cancel(gid);
    if (r.status !== "cancelled") {
      return {
        status: "failed",
        reason: `기존 예약 취소 실패: ${r.reason}. 발송 시각 10분 전이 지났을 수 있습니다.`,
      };
    }
  }

  // 2) 메시지 '대기' 리셋(vendor_message_id 제거) — drain 이 다시 접수하도록.
  const { error: msgErr } = (await (
    supabase.from("crm_messages") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (c: string, v: string) => Promise<{ error: { message: string } | null }>;
      };
    }
  )
    .update({
      status: "대기",
      vendor_message_id: null,
      cost: 0,
      sent_at: null,
      failed_reason: null,
    })
    .eq("campaign_id", campaignId)) as { error: { message: string } | null };
  if (msgErr) {
    return { status: "failed", reason: `메시지 리셋 실패: ${msgErr.message}` };
  }

  // 3) 캠페인 새 시각 + '발송중'(원자적 — 예약됨일 때만).
  const { data: updated, error: campErr } = (await (
    supabase.from("crm_campaigns") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (
          c: string,
          v: string,
        ) => {
          eq: (
            c: string,
            v: string,
          ) => {
            select: (cols: string) => Promise<{
              data: { id: string }[] | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    }
  )
    .update({
      scheduled_at: newDate.toISOString(),
      sent_at: null,
      // 자체 지연발송(30분 미만)은 '예약됨' 유지 → cron 이 시각 도래 시 발송.
      // 네이티브(30분 이상)는 '발송중' → drain 이 sendon reservation 재접수.
      status: isSelfDelayed ? "예약됨" : "발송중",
      total_cost: 0,
    })
    .eq("id", campaignId)
    .eq("status", "예약됨")
    .select("id")) as {
    data: { id: string }[] | null;
    error: { message: string } | null;
  };
  if (campErr) {
    return { status: "failed", reason: `예약 변경 처리 실패: ${campErr.message}` };
  }
  if (!updated || updated.length === 0) {
    return { status: "failed", reason: "이미 처리되어 변경할 수 없습니다" };
  }

  // 4) 자체 지연발송이면 지금 drain 을 킥하지 않는다 — '예약됨' + '대기' 로 두고
  //    cron(dispatch-scheduled)이 새 예약 시각 도래 시 발송한다.
  if (isSelfDelayed) {
    return { status: "rescheduled", scheduledAt: newDate.toISOString() };
  }

  // 네이티브 예약: drain 재킥 → 새 scheduled_at 으로 sendon reservation 재접수.
  const secret = process.env.DRAIN_SECRET;
  if (!secret) {
    return {
      status: "failed",
      reason: "DRAIN_SECRET 환경변수가 설정되어 있지 않습니다",
    };
  }
  waitUntil(
    fetch(`${getMessagingBaseUrl()}/api/messaging/drain`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-drain-secret": secret },
      body: JSON.stringify({ campaignId }),
      keepalive: true,
    }).catch(() => {
      /* 첫 킥 실패는 무시 — 캠페인은 '발송중' 으로 남고 수동 재시도 가능 */
    }),
  );

  return { status: "rescheduled", scheduledAt: newDate.toISOString() };
}
