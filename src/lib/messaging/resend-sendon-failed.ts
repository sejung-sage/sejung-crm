/**
 * 예약 캠페인의 "sendon 실패 건만" 재발송 — master 전용.
 *
 * 배경: 예약 접수 시 sendon 이 일부만 받아들이고 나머지를 처리 실패(예: 포인트
 * 부족)시켰는데, 우리 DB 는 전부 '발송됨' 으로 남아 있는 경우(도달 확인 webhook
 * 미구현). 살아있는 정상 예약은 건드리지 않고, sendon 이 '실패(FAILED)' 로 친
 * 건만 골라 같은 예약 시각으로 재접수한다.
 *
 * "같은 시각으로 재발송"(resend-scheduled-campaign)과의 차이:
 *   - resend-scheduled 는 살아있는 예약을 모두 취소하고 전체를 재예약한다.
 *     취소가 일부 실패하면 중복 발송 위험이 있다.
 *   - 본 함수는 sendon 기준 FAILED 건만 '대기' 로 되돌려 재접수하므로, 정상
 *     예약분(이미 sendon 에 살아있는 건)을 전혀 건드리지 않는다 → 중복 위험 0.
 *
 * 흐름:
 *   1. master 권한 + status='예약됨' + scheduled_at 이 미래(재예약 가능)인지 검증.
 *   2. 캠페인의 groupId(vendor_message_id)별로 sendon FAILED 메시지 목록 조회 →
 *      실패한 수신번호 집합 확보.
 *   3. 그 번호와 매칭되는 '발송됨' 메시지만 '대기' 로 리셋
 *      (vendor_message_id/cost/sent_at/delivered_at 초기화, failed_reason 기록).
 *   4. 정정: 리셋한 건들의 기존 비용을 campaign.total_cost 에서 차감(중복 계상 방지).
 *   5. campaign status='발송중' 조건부 전환(예약됨일 때만 — 동시성 안전).
 *   6. drain 킥 → scheduled_at 이 미래면 sendon reservation 으로 그 번호만 재접수,
 *      캠페인 '예약됨' 으로 다시 마감. 정상 예약분은 '발송됨' 그대로 유지.
 */

import { waitUntil } from "@vercel/functions";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getCampaign } from "@/lib/campaigns/get-campaign";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { createSmsAdapter } from "@/lib/messaging/adapters";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { getMessagingBaseUrl } from "./base-url";

export type ResendSendonFailedResult =
  | { status: "resent"; scheduledAt: string; requeued: number }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode"; reason: string };

type SrvClient = ReturnType<typeof createSupabaseServiceClient>;

/** 한 번에 UPDATE 하는 id 청크 — PostgREST URL 길이/요청 한도 회피. */
const UPDATE_ID_CHUNK = 200;

/** 숫자만 남긴 정규화 번호(매칭 키). */
function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

export async function resendSendonFailed(
  campaignId: string,
): Promise<ResendSendonFailedResult> {
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
      reason: `예약 상태가 아니라 실패 건만 재발송할 수 없습니다 (현재: ${campaign.status})`,
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

  // 1) groupId(vendor_message_id) 수집.
  const groupIds = await collectGroupIds(supabase, campaignId);
  if (groupIds.length === 0) {
    return { status: "failed", reason: "조회할 sendon 그룹이 없습니다" };
  }

  // 2) 각 groupId 의 sendon FAILED 메시지 → 실패 번호 집합.
  const adapter = createSmsAdapter();
  const failedPhones = new Set<string>();
  let firstReason = "";
  const queryErrors: string[] = [];
  for (const gid of groupIds) {
    const list = await adapter.listGroupMessages(gid, "FAILED");
    if (!list.ok) {
      if (list.reason) queryErrors.push(list.reason);
      continue;
    }
    for (const m of list.messages) {
      const p = normalizePhone(m.to);
      if (p) failedPhones.add(p);
      if (!firstReason && m.resultText?.trim()) firstReason = m.resultText.trim();
    }
  }

  if (failedPhones.size === 0) {
    if (queryErrors.length > 0) {
      return {
        status: "failed",
        reason: `sendon 실패 목록 조회에 실패했습니다: ${queryErrors[0]}`,
      };
    }
    return { status: "failed", reason: "재발송할 sendon 실패 건이 없습니다" };
  }

  // 3) 실패 번호와 매칭되는 '발송됨' 메시지 id·비용 수집.
  const sent = await fetchSentMessages(supabase, campaignId);
  let oldCostSum = 0;
  const targetIds: string[] = [];
  for (const m of sent) {
    if (failedPhones.has(normalizePhone(m.phone))) {
      targetIds.push(m.id);
      oldCostSum += typeof m.cost === "number" ? m.cost : 0;
    }
  }

  if (targetIds.length === 0) {
    return {
      status: "failed",
      reason: "sendon 실패 번호와 매칭되는 발송됨 메시지가 없습니다",
    };
  }

  // 4) 매칭 메시지들 '대기' 리셋 (id 청크 단위).
  const failedReason = firstReason
    ? `sendon 실패 재발송: ${firstReason}`.slice(0, 200)
    : "sendon 실패 재발송";
  for (let i = 0; i < targetIds.length; i += UPDATE_ID_CHUNK) {
    const chunk = targetIds.slice(i, i + UPDATE_ID_CHUNK);
    const { error } = await (
      supabase.from("crm_messages") as unknown as {
        update: (v: Record<string, unknown>) => {
          in: (
            c: string,
            v: string[],
          ) => Promise<{ error: { message: string } | null }>;
        };
      }
    )
      .update({
        status: "대기",
        vendor_message_id: null,
        cost: 0,
        sent_at: null,
        delivered_at: null,
        failed_reason: failedReason,
      })
      .in("id", chunk);
    if (error) {
      return { status: "failed", reason: `메시지 리셋 실패: ${error.message}` };
    }
  }

  // 5) campaign '발송중' 조건부 전환 + 비용 정정(차감). scheduled_at 유지.
  const currentTotal =
    typeof campaign.total_cost === "number" ? campaign.total_cost : 0;
  const newTotal = Math.max(0, Math.round(currentTotal - oldCostSum));
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
    .update({ status: "발송중", total_cost: newTotal })
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

  // 6) drain 재킥 → scheduled_at 미래면 sendon reservation 으로 그 번호만 재접수.
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

  return {
    status: "resent",
    scheduledAt: scheduledAt.toISOString(),
    requeued: targetIds.length,
  };
}

/** 캠페인의 distinct vendor_message_id(groupId) 수집. */
async function collectGroupIds(
  supabase: SrvClient,
  campaignId: string,
): Promise<string[]> {
  const { data } = (await supabase
    .from("crm_messages")
    .select("vendor_message_id")
    .eq("campaign_id", campaignId)
    .not("vendor_message_id", "is", null)) as unknown as {
    data: { vendor_message_id: string | null }[] | null;
  };
  return Array.from(
    new Set(
      (data ?? [])
        .map((r) => r.vendor_message_id)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  );
}

/** 캠페인의 '발송됨' 비-테스트 메시지(id, phone, cost) 페이지네이션 수집. */
async function fetchSentMessages(
  supabase: SrvClient,
  campaignId: string,
): Promise<Array<{ id: string; phone: string; cost: number | null }>> {
  const out: Array<{ id: string; phone: string; cost: number | null }> = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("crm_messages")
      .select("id, phone, cost")
      .eq("campaign_id", campaignId)
      .eq("status", "발송됨")
      .eq("is_test", false)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`발송됨 메시지 조회 실패: ${error.message}`);
    const rows = (data ?? []) as Array<{
      id: string;
      phone: string;
      cost: number | null;
    }>;
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}
