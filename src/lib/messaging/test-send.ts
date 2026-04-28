/**
 * F3 Part B · 테스트 발송 (본인 번호 1건).
 *
 * Compose 3단계 미리보기 옆 "테스트 발송" 버튼이 호출.
 * 동작 요지:
 *   - dev-seed 모드 → 차단.
 *   - 1건짜리 캠페인을 만들고 (`is_test=true`, title=자동), messages 도 1건 INSERT.
 *   - 가드는 정보성/광고성에 따라 적용되며 야간 광고 차단 동일.
 *   - 어댑터 1회 호출 → 결과를 messages 갱신 → 캠페인 상태 갱신.
 *
 * 통계 영향:
 *   - is_test=true 캠페인/메시지는 캠페인 리스트에서 별도 표시(또는 제외)되어
 *     운영 통계에 섞이지 않는다(0007 마이그레이션 보장).
 */

import { createSmsAdapter } from "./adapters";
import type { SmsSendResult } from "./adapters/types";
import { applyAllGuards } from "./guards";
import { calculateCost } from "./calculate-cost";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SendCampaignResult } from "./send-campaign";

export interface TestSendInput {
  body: string;
  subject: string | null;
  type: "SMS" | "LMS" | "ALIMTALK";
  isAd: boolean;
  /** 테스트 수신 번호 (하이픈 무관 — 내부에서 정규화). */
  toPhone: string;
}

type SupabaseSrv = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export async function testSend(
  input: TestSendInput,
): Promise<SendCampaignResult> {
  // 1) dev-seed 차단
  if (isDevSeedMode()) {
    return {
      status: "dev_seed_mode",
      reason: "개발 시드 모드에서는 실제 테스트 발송이 차단됩니다",
    };
  }

  // 2) 인증 (테스트 발송은 본인 계정 — 권한 모든 역할 허용 X.
  //    Compose 단계까지 들어왔다면 send 권한 보유했다고 보지만,
  //    다시 한 번 user 만 확보하면 충분. 분원 검사는 그룹 미연결이라 생략.)
  const user = await getCurrentUser();
  if (!user) {
    return { status: "failed", reason: "로그인 후 이용 가능합니다" };
  }

  const phone = input.toPhone.replace(/\D/g, "");
  if (!/^01[016789][0-9]{7,8}$/.test(phone)) {
    return { status: "failed", reason: "휴대폰 번호 형식이 올바르지 않습니다" };
  }

  // 3) 가드 적용 (야간 광고 차단 등)
  const guarded = applyAllGuards({
    body: input.body,
    isAd: input.isAd,
    scheduledAt: new Date(),
    recipients: [
      {
        studentId: null,
        phone,
        name: "테스트 수신자",
        status: "재원생",
      },
    ],
    unsubscribedPhones: [],
  });

  if (!guarded.allowedToSend) {
    return {
      status: "blocked",
      reason: guarded.blockReason ?? "야간 광고 차단 시간대입니다",
    };
  }
  if (guarded.eligible.length === 0) {
    // 1건 입력 → 가드가 막을 일은 사실상 없지만 방어
    return { status: "failed", reason: "발송 가능한 수신자가 없습니다" };
  }

  const supabase = await createSupabaseServerClient();

  // 4) 캠페인 INSERT (is_test=true)
  const title = `[테스트] ${shortenForTitle(input.body)}`;
  const campaignInsert: Record<string, unknown> = {
    title,
    template_id: null,
    group_id: null,
    scheduled_at: null,
    sent_at: new Date().toISOString(),
    status: "발송중",
    total_recipients: 1,
    total_cost: 0,
    created_by: user.user_id,
    branch: user.branch,
    is_test: true,
  };

  const inserted = await insertCampaign(supabase, campaignInsert);
  if (!inserted.ok) {
    return { status: "failed", reason: inserted.reason };
  }
  const campaignId = inserted.id;

  // 5) messages INSERT (1건, is_test=true)
  const msgRow = {
    campaign_id: campaignId,
    student_id: null,
    phone,
    status: "대기",
    vendor_message_id: null,
    cost: 0,
    sent_at: null,
    delivered_at: null,
    failed_reason: null,
    is_test: true,
  };

  const msgInserted = await insertMessage(supabase, msgRow);
  if (!msgInserted.ok) {
    await safeUpdateCampaignStatus(supabase, campaignId, "실패", 0);
    return { status: "failed", reason: msgInserted.reason };
  }

  // 6) 어댑터 1회 호출
  const adapter = createSmsAdapter();
  const fromNumber = readFromNumber(adapter.name);
  if (!fromNumber) {
    await safeUpdateCampaignStatus(supabase, campaignId, "실패", 0);
    return {
      status: "failed",
      reason: "발신번호 환경변수가 설정되어 있지 않습니다",
    };
  }

  let sentOk = 0;
  let failed = 0;
  let totalCost = 0;
  let result: SmsSendResult | null = null;
  try {
    result = await adapter.send({
      to: phone,
      body: guarded.finalBody,
      subject: input.subject,
      type: input.type,
      fromNumber,
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : "벤더 응답 오류";
    await updateMessage(supabase, msgInserted.id, {
      status: "실패",
      failed_reason: reason,
      sent_at: new Date().toISOString(),
    });
    await safeUpdateCampaignStatus(supabase, campaignId, "실패", 0);
    return { status: "failed", reason };
  }

  const nowIso = new Date().toISOString();
  if (result.status === "queued") {
    sentOk = 1;
    totalCost = calculateCost(input.type, 1).totalCost;
    await updateMessage(supabase, msgInserted.id, {
      status: "발송됨",
      vendor_message_id: result.vendorMessageId,
      cost: totalCost,
      sent_at: nowIso,
    });
  } else {
    failed = 1;
    await updateMessage(supabase, msgInserted.id, {
      status: "실패",
      failed_reason: result.reason,
      sent_at: nowIso,
    });
  }

  const finalStatus = failed === 1 ? "실패" : "완료";
  await safeUpdateCampaignStatus(
    supabase,
    campaignId,
    finalStatus,
    totalCost,
  );

  return {
    status: "success",
    campaignId,
    sent: sentOk,
    failed,
    cost: totalCost,
  };
}

// ─── 내부 헬퍼 (send-campaign 와 분리해 두어 결합도 낮춤) ─────

function shortenForTitle(body: string): string {
  const first = body.split("\n")[0]?.trim() ?? "";
  if (first.length <= 20) return first || "테스트 발송";
  return `${first.slice(0, 20)}...`;
}

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

type CampaignInsertReturn =
  | { ok: true; id: string }
  | { ok: false; reason: string };

async function insertCampaign(
  supabase: SupabaseSrv,
  payload: Record<string, unknown>,
): Promise<CampaignInsertReturn> {
  const { data, error } = await (
    supabase.from("campaigns") as unknown as {
      insert: (v: Record<string, unknown>) => {
        select: (cols: string) => {
          single: () => Promise<{
            data: { id: string } | null;
            error: { message: string } | null;
          }>;
        };
      };
    }
  )
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    return { ok: false, reason: `캠페인 생성 실패: ${error.message}` };
  }
  if (!data) {
    return { ok: false, reason: "생성된 캠페인 ID 를 읽지 못했습니다" };
  }
  return { ok: true, id: data.id };
}

type MessageInsertReturn =
  | { ok: true; id: string }
  | { ok: false; reason: string };

async function insertMessage(
  supabase: SupabaseSrv,
  payload: Record<string, unknown>,
): Promise<MessageInsertReturn> {
  const { data, error } = await (
    supabase.from("messages") as unknown as {
      insert: (v: Record<string, unknown>) => {
        select: (cols: string) => {
          single: () => Promise<{
            data: { id: string } | null;
            error: { message: string } | null;
          }>;
        };
      };
    }
  )
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    return { ok: false, reason: `메시지 적재 실패: ${error.message}` };
  }
  if (!data) {
    return { ok: false, reason: "메시지 ID 를 읽지 못했습니다" };
  }
  return { ok: true, id: data.id };
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
  totalCost: number,
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
    .update({ status, total_cost: totalCost })
    .eq("id", campaignId);
}
