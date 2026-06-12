/**
 * 예약 발송 취소 (sendon 네이티브).
 *
 * 예약 발송은 sendon `reservation` 으로 접수되며, 각 batch 의 groupId 가
 * crm_messages.vendor_message_id 에 저장된다. 취소는 그 groupId 들을 모아
 * sendon `sms.cancel(groupId)` 로 실제 예약을 취소한 뒤, 메시지·캠페인 상태를
 * '취소' 로 정리한다.
 *
 * 안전 가드:
 *   - dev-seed 모드 차단
 *   - 캠페인 존재 + 본 분원 send 권한 확인
 *   - status='예약됨' 일 때만 허용
 *   - sendon 제약: 예약 시각 10분 전까지만 취소 가능(지나면 sendon 이 실패 반환)
 *   - 하나라도 sendon 취소 실패 시 DB 상태를 바꾸지 않고 실패 반환
 *     (예약이 그대로 발송될 수 있으므로 운영자에게 명확히 알린다)
 */

import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/can";
import { getCampaign } from "@/lib/campaigns/get-campaign";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { createSmsAdapter } from "@/lib/messaging/adapters";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";

export type CancelScheduledResult =
  | { status: "cancelled" }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode"; reason: string };

export async function cancelScheduledCampaign(
  campaignId: string,
): Promise<CancelScheduledResult> {
  if (isDevSeedMode()) {
    return {
      status: "dev_seed_mode",
      reason: "개발 시드 모드에서는 예약 취소가 차단됩니다",
    };
  }

  if (!campaignId || typeof campaignId !== "string") {
    return { status: "failed", reason: "캠페인 ID 가 유효하지 않습니다" };
  }

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
      reason: `예약 상태가 아니라 취소할 수 없습니다 (현재: ${campaign.status})`,
    };
  }

  const supabase = createSupabaseServiceClient();

  // 1) 이 캠페인이 sendon 에 접수한 예약 groupId 들(메시지의 vendor_message_id).
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

  // 2) sendon 예약 취소 — groupId 단위. 하나라도 실패하면 중단(발송 위험 알림).
  const adapter = createSmsAdapter();
  for (const gid of groupIds) {
    const r = await adapter.cancel(gid);
    if (r.status !== "cancelled") {
      return {
        status: "failed",
        reason: `sendon 예약 취소 실패: ${r.reason}. 발송 시각 10분 전이 지났을 수 있습니다.`,
      };
    }
  }

  // 3) DB 정리 — 메시지·캠페인 '취소'. 캠페인은 원자적(예약됨일 때만).
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
    .update({ status: "취소" })
    .eq("id", campaignId)
    .eq("status", "예약됨")
    .select("id")) as {
    data: { id: string }[] | null;
    error: { message: string } | null;
  };
  if (campErr) {
    return { status: "failed", reason: `예약 취소 처리 실패: ${campErr.message}` };
  }
  if (!updated || updated.length === 0) {
    return { status: "failed", reason: "이미 처리되어 취소할 수 없습니다" };
  }

  // 메시지는 enum 에 '취소' 가 없어 '실패' + 사유로 정리(베스트에포트).
  await (
    supabase.from("crm_messages") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (c: string, v: string) => Promise<{ error: unknown }>;
      };
    }
  )
    .update({ status: "실패", failed_reason: "예약 취소" })
    .eq("campaign_id", campaignId);

  return { status: "cancelled" };
}
