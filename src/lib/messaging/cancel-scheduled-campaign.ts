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

import { waitUntil } from "@vercel/functions";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/can";
import { getCampaign } from "@/lib/campaigns/get-campaign";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { createSmsAdapter } from "@/lib/messaging/adapters";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";

/** sendon 예약 취소 동시 호출 상한(sendon 레이트리밋 보호). */
const CANCEL_CONCURRENCY = 8;

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

  // 1) 이 캠페인이 sendon 에 접수한 예약 groupId 들(DISTINCT).
  //    crm_messages 통째 select 는 max_rows(1000)에 잘려 대형 예약에서 일부
  //    groupId 를 놓치므로(=취소 표시돼도 발송됨), DISTINCT RPC 로 전체를 확보한다.
  const { data: rows, error: readErr } = await (
    supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{
      data: { vendor_message_id: string | null }[] | null;
      error: { message: string } | null;
    }>
  )("crm_campaign_reservation_group_ids", { p_campaign_id: campaignId });
  if (readErr) {
    return { status: "failed", reason: `예약 정보 조회 실패: ${readErr.message}` };
  }
  const groupIds = (rows ?? [])
    .map((r) => r.vendor_message_id)
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  // 2) sendon 예약 취소 — groupId 단위 병렬(동시성 제한). 하나라도 실패하면
  //    DB 를 바꾸지 않고 중단한다(예약이 그대로 발송될 수 있으므로 명확히 알림).
  //    실제 취소 확인은 동기로 유지(안전 핵심). 병렬화로 왕복이 겹쳐 빠르다.
  const adapter = createSmsAdapter(campaign.branch);
  const cancelResults: { status: string; reason?: string }[] = [];
  let cursor = 0;
  async function cancelWorker() {
    while (cursor < groupIds.length) {
      const idx = cursor++;
      cancelResults[idx] = await adapter.cancel(groupIds[idx]);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(CANCEL_CONCURRENCY, groupIds.length) },
      cancelWorker,
    ),
  );
  const firstFail = cancelResults.find((r) => r.status !== "cancelled");
  if (firstFail) {
    return {
      status: "failed",
      reason: `sendon 예약 취소 실패: ${firstFail.reason}. 발송 시각 10분 전이 지났을 수 있습니다.`,
    };
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

  // 4) 메시지 대량 정리는 백그라운드로 뺀다(수천~수만 행 UPDATE → UI 블로킹 방지).
  //    sendon 예약은 이미 취소됐고 캠페인 status='취소' 라 발송은 멈춘 상태이므로,
  //    건별 status 표시는 fire-and-forget 로 이어가도 안전하다. 사용자는 즉시
  //    다른 작업을 계속할 수 있다. (enum 에 '취소' 가 없어 '실패' + 사유로 표기)
  waitUntil(
    (async () => {
      await (
        supabase.from("crm_messages") as unknown as {
          update: (v: Record<string, unknown>) => {
            eq: (c: string, v: string) => Promise<{ error: unknown }>;
          };
        }
      )
        .update({ status: "실패", failed_reason: "예약 취소" })
        .eq("campaign_id", campaignId);
    })(),
  );

  return { status: "cancelled" };
}
