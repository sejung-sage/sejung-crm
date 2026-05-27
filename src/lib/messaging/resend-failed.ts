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
import { applyAllGuards, type Recipient } from "./guards";
import { calculateCost } from "./calculate-cost";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/can";
import { getCampaign } from "@/lib/campaigns/get-campaign";
import { getUnsubscribedPhones } from "./unsubscribed-phones";
import { getTemplate } from "@/lib/templates/get-template";
import type { SendCampaignResult } from "./send-campaign";
import {
  readFromNumber,
  extractFailedReason,
  updateMessage,
  safeUpdateCampaignStatus,
  incrementCampaignCost,
} from "./message-update-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const SEND_BATCH_SIZE = 100;

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
    .from("crm_messages")
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

  // 수신거부 phone — React cache dedupe.
  let unsubscribedPhones: string[];
  try {
    unsubscribedPhones = await getUnsubscribedPhones();
  } catch (e) {
    return {
      status: "failed",
      reason: e instanceof Error ? e.message : "수신거부 목록 조회에 실패했습니다",
    };
  }

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
          isAd: template.is_ad,
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
        // messages.cost INT — 소수 단가는 round 후 저장 (합산은 float 으로 보존).
        await updateMessage(supabase, msgId, {
          status: "발송됨",
          vendor_message_id: sr.value.vendorMessageId,
          cost: Math.round(unitCost),
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
