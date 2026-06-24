/**
 * 예약 캠페인 "같은 시각으로 강제 재발송" — master 전용.
 *
 * 배경: sendon 이 예약 접수를 처리 실패(잔액 부족 등)시켰는데 우리 DB 는 '예약됨 +
 * 발송됨' 으로 남아 있는 경우(도달 확인 webhook 미구현). 포인트 충전 후, 같은 예약
 * 시각으로 다시 sendon 에 접수시킨다.
 *
 * reschedule(예약 변경)과의 차이:
 *   - reschedule 은 기존 sendon 예약 취소가 실패하면 전체 중단한다(살아있는 예약 보호).
 *   - 본 함수는 "이미 sendon 에서 실패한 예약" 을 대상으로 하므로, 기존 예약 취소를
 *     best-effort 로 시도(실패해도 무시)하고 재접수까지 진행한다. 운영자가 sendon
 *     콘솔에서 "처리 실패" 를 확인했다는 전제(UI confirm).
 *
 * 흐름:
 *   1. master 권한 + status='예약됨' + scheduled_at 이 미래인지 검증.
 *   2. 기존 vendor_message_id 들 sendon cancel best-effort(살아있던 잔여 예약 제거 —
 *      이중 발송 방지). 실패는 경고만.
 *   3. messages 전부 '대기' 리셋(vendor_message_id/cost/sent_at/failed_reason 초기화).
 *   4. campaign status='발송중' 으로 조건부 전환(예약됨일 때만 — 동시성 안전) +
 *      scheduled_at 유지.
 *   5. drain 킥 → scheduled_at 이 미래(30분+)면 sendon reservation 재접수, 캠페인
 *      '예약됨' 으로 다시 마감.
 */

import { waitUntil } from "@vercel/functions";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getCampaign } from "@/lib/campaigns/get-campaign";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { createSmsAdapter } from "@/lib/messaging/adapters";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { getMessagingBaseUrl } from "./base-url";

export type ResendScheduledResult =
  | { status: "resent"; scheduledAt: string }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode"; reason: string };

export async function resendScheduledCampaign(
  campaignId: string,
): Promise<ResendScheduledResult> {
  if (isDevSeedMode()) {
    return {
      status: "dev_seed_mode",
      reason: "개발 시드 모드에서는 재발송이 차단됩니다",
    };
  }
  if (!campaignId || typeof campaignId !== "string") {
    return { status: "failed", reason: "캠페인 ID 가 유효하지 않습니다" };
  }

  const user = await getCurrentUser();
  if (!user) return { status: "failed", reason: "로그인 후 이용 가능합니다" };
  if (user.role !== "master") {
    return { status: "failed", reason: "마스터 계정만 재발송할 수 있습니다" };
  }

  const campaign = await getCampaign(campaignId);
  if (!campaign) {
    return { status: "failed", reason: "존재하지 않는 캠페인입니다" };
  }
  if (campaign.status !== "예약됨") {
    return {
      status: "failed",
      reason: `예약 상태가 아니라 재발송할 수 없습니다 (현재: ${campaign.status})`,
    };
  }
  if (!campaign.scheduled_at) {
    return { status: "failed", reason: "예약 시각이 없습니다" };
  }
  const scheduledAt = new Date(campaign.scheduled_at);
  if (Number.isNaN(scheduledAt.getTime())) {
    return { status: "failed", reason: "예약 시각 형식이 올바르지 않습니다" };
  }
  if (scheduledAt.getTime() <= Date.now()) {
    return {
      status: "failed",
      reason:
        "예약 시각이 이미 지났습니다. 같은 시각 재발송은 불가하니 새로 발송해 주세요.",
    };
  }

  const supabase = createSupabaseServiceClient();

  // 1) 기존 sendon 예약 취소 — best-effort. 이미 처리 실패면 취소할 게 없어 실패가 정상.
  //    살아있던 잔여 예약이 있으면 제거해 이중 발송을 막는다.
  const { data: rows } = (await supabase
    .from("crm_messages")
    .select("vendor_message_id")
    .eq("campaign_id", campaignId)
    .not("vendor_message_id", "is", null)) as unknown as {
    data: { vendor_message_id: string | null }[] | null;
  };
  const groupIds = Array.from(
    new Set(
      (rows ?? [])
        .map((r) => r.vendor_message_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  );
  const adapter = createSmsAdapter();
  for (const gid of groupIds) {
    try {
      const r = await adapter.cancel(gid);
      if (r.status !== "cancelled") {
        console.warn(`[resend-scheduled] 기존 예약 취소 무시: ${r.reason}`);
      }
    } catch (e) {
      console.warn(
        `[resend-scheduled] 취소 호출 예외 무시: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // 2) 메시지 전부 '대기' 리셋.
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
      delivered_at: null,
      failed_reason: null,
    })
    .eq("campaign_id", campaignId)) as { error: { message: string } | null };
  if (msgErr) {
    return { status: "failed", reason: `메시지 리셋 실패: ${msgErr.message}` };
  }

  // 3) campaign '발송중' 조건부 전환(예약됨일 때만). scheduled_at 유지.
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
    .update({ status: "발송중", sent_at: null, total_cost: 0 })
    .eq("id", campaignId)
    .eq("status", "예약됨")
    .select("id")) as {
    data: { id: string }[] | null;
    error: { message: string } | null;
  };
  if (campErr) {
    return { status: "failed", reason: `재발송 처리 실패: ${campErr.message}` };
  }
  if (!updated || updated.length === 0) {
    return { status: "failed", reason: "이미 처리되어 재발송할 수 없습니다" };
  }

  // 4) drain 재킥 → scheduled_at 미래(30분+)면 sendon reservation 재접수.
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
      /* 첫 킥 실패는 무시 — 캠페인은 '발송중' 으로 남고 수동 재시도/sweep 으로 회복 */
    }),
  );

  return { status: "resent", scheduledAt: scheduledAt.toISOString() };
}
