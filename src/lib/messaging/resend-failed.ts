/**
 * F3 Part B · 캠페인 실패 건 재발송.
 *
 * 캠페인 상세에서 "실패 건만 재발송" 버튼이 호출.
 * 동작:
 *   1) dev-seed 모드 차단.
 *   2) 캠페인 조회 → 권한 검사 (본 분원 send 권한).
 *   3) messages where status='실패' AND is_test=false 모두 재시도.
 *   4) 어댑터가 다시 호출 → 결과로 messages 갱신, total_cost 누적.
 *
 * NOTE: 본문은 첫 발송 당시 messages 에 저장하지 않으므로, 캠페인의 템플릿/본문을
 *   다시 가져와야 한다. MVP 는 templates 테이블에서 조회 (template_id가 있을 경우).
 *   inline 본문(template_id null) 캠페인은 재발송 불가하도록 안전 차단.
 */

import { revalidatePath } from "next/cache";
import { createSmsAdapter } from "./adapters";
import type { SmsSendResult } from "./adapters/types";
import { applyAllGuards, type Recipient } from "./guards";
import { calculateCost } from "./calculate-cost";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/can";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCampaign } from "@/lib/campaigns/get-campaign";
import { getTemplate } from "@/lib/templates/get-template";
import type { SendCampaignResult } from "./send-campaign";

const SEND_BATCH_SIZE = 100;

type SupabaseSrv = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export async function resendFailedMessages(
  campaignId: string,
): Promise<SendCampaignResult> {
  if (isDevSeedMode()) {
    return {
      status: "dev_seed_mode",
      reason: "개발 시드 모드에서는 실제 재발송이 차단됩니다",
    };
  }

  if (!campaignId || typeof campaignId !== "string") {
    return { status: "failed", reason: "캠페인 ID 가 유효하지 않습니다" };
  }

  // 1) 캠페인 조회 + 권한
  const campaign = await getCampaign(campaignId);
  if (!campaign) {
    return { status: "failed", reason: "존재하지 않는 캠페인입니다" };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { status: "failed", reason: "로그인 후 이용 가능합니다" };
  }
  if (!can(user, "send", "campaign", campaign.branch)) {
    return {
      status: "failed",
      reason: "본 분원 캠페인 발송 권한이 없습니다",
    };
  }

  // 2) 본문 확보. inline 본문(template_id null) 은 재발송 불가.
  if (!campaign.template_id) {
    return {
      status: "failed",
      reason: "직접 작성 본문 캠페인은 재발송이 지원되지 않습니다",
    };
  }
  const template = await getTemplate(campaign.template_id);
  if (!template) {
    return {
      status: "failed",
      reason: "원본 템플릿을 찾지 못해 재발송할 수 없습니다",
    };
  }

  const supabase = await createSupabaseServerClient();

  // 3) 실패 메시지만 조회 (is_test 제외 — 테스트 발송 캠페인은 별도 처리)
  const { data: failedRows, error: fetchError } = await supabase
    .from("messages")
    .select("id, phone, student_id")
    .eq("campaign_id", campaignId)
    .eq("status", "실패")
    .eq("is_test", false);

  if (fetchError) {
    return {
      status: "failed",
      reason: `실패 메시지 조회에 실패했습니다: ${fetchError.message}`,
    };
  }

  const failedMessages = (failedRows ?? []) as {
    id: string;
    phone: string;
    student_id: string | null;
  }[];

  if (failedMessages.length === 0) {
    return { status: "failed", reason: "재발송할 실패 메시지가 없습니다" };
  }

  // 4) 가드 다시 적용 (특히 야간 광고 차단·수신거부 갱신 반영)
  const recipients: Recipient[] = failedMessages.map((m) => ({
    studentId: m.student_id,
    phone: m.phone.replace(/\D/g, ""),
    name: "",
    status: "재원생",
  }));

  // 최신 unsubscribes 조회
  const { data: unsubData, error: unsubError } = await supabase
    .from("unsubscribes")
    .select("phone");
  if (unsubError) {
    return {
      status: "failed",
      reason: `수신거부 목록 조회에 실패했습니다: ${unsubError.message}`,
    };
  }
  const unsubscribedPhones = (unsubData ?? [])
    .map((r) => (r as { phone: string }).phone)
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  const guarded = applyAllGuards({
    body: template.body,
    isAd: template.is_ad,
    scheduledAt: new Date(),
    recipients,
    unsubscribedPhones,
  });

  if (!guarded.allowedToSend) {
    return {
      status: "blocked",
      reason: guarded.blockReason ?? "야간 광고 차단 시간대입니다",
    };
  }
  if (guarded.eligible.length === 0) {
    return {
      status: "failed",
      reason: "재발송 가능한 수신자가 없습니다(전원 수신거부)",
    };
  }

  // eligible 와 원본 messages.id 매핑
  const phoneToMsgId = new Map<string, string>();
  for (const m of failedMessages) {
    phoneToMsgId.set(m.phone.replace(/\D/g, ""), m.id);
  }

  const adapter = createSmsAdapter();
  const fromNumber = readFromNumber(adapter.name);
  if (!fromNumber) {
    return {
      status: "failed",
      reason: "발신번호 환경변수가 설정되어 있지 않습니다",
    };
  }

  // 캠페인 상태를 발송중으로 갱신
  await safeUpdateCampaignStatus(supabase, campaignId, "발송중");

  let sentOk = 0;
  let failed = 0;
  let addedCost = 0;

  for (let i = 0; i < guarded.eligible.length; i += SEND_BATCH_SIZE) {
    const batch = guarded.eligible.slice(i, i + SEND_BATCH_SIZE);
    const sendResults = await Promise.allSettled(
      batch.map((r) =>
        adapter.send({
          to: r.phone,
          body: guarded.finalBody,
          subject: template.subject,
          type: template.type,
          fromNumber,
        }),
      ),
    );

    for (let j = 0; j < batch.length; j += 1) {
      const r = batch[j];
      if (!r) continue;
      const msgId = phoneToMsgId.get(r.phone);
      if (!msgId) continue;

      const sr = sendResults[j];
      const nowIso = new Date().toISOString();

      if (sr && sr.status === "fulfilled" && sr.value.status === "queued") {
        sentOk += 1;
        const unitCost = calculateCost(template.type, 1).totalCost;
        addedCost += unitCost;
        await updateMessage(supabase, msgId, {
          status: "발송됨",
          vendor_message_id: sr.value.vendorMessageId,
          cost: unitCost,
          sent_at: nowIso,
          failed_reason: null,
        });
      } else {
        failed += 1;
        const reason = extractFailedReason(sr);
        await updateMessage(supabase, msgId, {
          status: "실패",
          failed_reason: reason,
          sent_at: nowIso,
        });
      }
    }
  }

  // 캠페인 누적 비용 + 상태 갱신
  await incrementCampaignCost(supabase, campaignId, addedCost);
  // 부분 실패는 '완료' 유지. 전부 실패면 '실패'.
  await safeUpdateCampaignStatus(
    supabase,
    campaignId,
    failed === guarded.eligible.length ? "실패" : "완료",
  );

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${campaignId}`);

  return {
    status: "success",
    campaignId,
    sent: sentOk,
    failed,
    cost: addedCost,
  };
}

// ─── 헬퍼 ──────────────────────────────────────────────────

function readFromNumber(adapterName: string): string | null {
  switch (adapterName) {
    case "solapi":
      return process.env.SOLAPI_FROM_NUMBER ?? "01000000000";
    case "munjanara":
      return process.env.MUNJANARA_FROM_NUMBER ?? "01000000000";
    case "sk-togo":
      return process.env.SK_TOGO_FROM_NUMBER ?? "01000000000";
    case "sendwise":
      return process.env.SENDWISE_FROM_NUMBER ?? "01000000000";
    default:
      return null;
  }
}

function extractFailedReason(
  sr: PromiseSettledResult<SmsSendResult> | undefined,
): string {
  if (!sr) return "발송 결과를 읽지 못했습니다";
  if (sr.status === "rejected") {
    const e = sr.reason;
    if (e instanceof Error) return e.message;
    return "벤더 응답 오류";
  }
  if (sr.value.status === "failed") {
    return sr.value.reason;
  }
  return "벤더 응답이 비정상입니다";
}

async function updateMessage(
  supabase: SupabaseSrv,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await (
    supabase.from("messages") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (
          col: string,
          val: string,
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )
    .update(patch)
    .eq("id", id);
}

async function safeUpdateCampaignStatus(
  supabase: SupabaseSrv,
  campaignId: string,
  status: "발송중" | "완료" | "실패",
): Promise<void> {
  await (
    supabase.from("campaigns") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (
          col: string,
          val: string,
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )
    .update({ status })
    .eq("id", campaignId);
}

async function incrementCampaignCost(
  supabase: SupabaseSrv,
  campaignId: string,
  added: number,
): Promise<void> {
  if (added <= 0) return;

  // 현재값 + added 로 단순 갱신 (race 가능성은 매우 낮은 워크플로우).
  // 강한 원자성 필요시 RPC SQL 함수로 옮길 수 있음 (Phase 1).
  const { data: cur } = await supabase
    .from("campaigns")
    .select("total_cost")
    .eq("id", campaignId)
    .maybeSingle();

  const curRow = cur as unknown as { total_cost?: number } | null;
  const currentCost =
    typeof curRow?.total_cost === "number" ? curRow.total_cost : 0;

  await (
    supabase.from("campaigns") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (
          col: string,
          val: string,
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )
    .update({ total_cost: currentCost + added })
    .eq("id", campaignId);
}
