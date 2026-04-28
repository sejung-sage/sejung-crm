/**
 * F3 Part B · 캠페인 발송 오케스트레이터.
 *
 * 입력 (`SendCampaignInput`) 으로부터:
 *   1) dev-seed 모드 차단
 *   2) 권한 검사 (master/admin/manager · 본인 분원 그룹)
 *   3) previewRecipients 호출 → 야간 광고 차단 / 수신자 0명 케이스 처리
 *   4) 즉시 발송: campaigns INSERT(상태 발송중) → messages 일괄 INSERT(상태 대기)
 *               → 어댑터 호출(batch=100) → messages 상태 갱신
 *               → 모두 끝난 뒤 campaigns 상태(완료/실패) + total_cost 갱신
 *   5) 예약 발송: campaigns INSERT(상태 예약됨, scheduled_at 만 저장).
 *               messages 는 실 발송 시점(Phase 1 cron)에 INSERT.
 *
 * 발송 결과는 `SendCampaignResult` 의 discriminated union 으로 반환.
 * `revalidatePath('/campaigns')` 로 리스트 갱신.
 *
 * 보안:
 *   - SUPABASE 직접 INSERT/UPDATE 시 좁은 cast 사용 (groups/templates actions 패턴).
 *   - 학부모 번호는 raw 처리 (DB 저장은 raw, UI 측은 마스킹 표시 책임).
 *   - 어댑터/Supabase 에러 메시지에 API Key/Secret 이 섞일 가능성은 어댑터가 한 번 더
 *     필터링하지만, 본 레이어에서도 message 만 추출해 사용한다.
 */

import { revalidatePath } from "next/cache";
import { createSmsAdapter } from "./adapters";
import type { SmsSendResult } from "./adapters/types";
import { previewRecipients, type PreviewResult } from "./preview-recipients";
import { calculateCost } from "./calculate-cost";
import { applyAllGuards, type Recipient } from "./guards";
import { getGroup } from "@/lib/groups/get-group";
import { listGroupStudents } from "@/lib/groups/list-group-students";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/can";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface SendCampaignInput {
  title: string;
  groupId: string;
  /** null 이면 inline 본문 (템플릿 미사용). */
  templateId: string | null;
  body: string;
  /** SMS 는 null. LMS/알림톡은 필수. */
  subject: string | null;
  type: "SMS" | "LMS" | "ALIMTALK";
  isAd: boolean;
  /** null 이면 즉시 발송. */
  scheduledAt: Date | null;
  isTest: boolean;
}

export type SendCampaignResult =
  | {
      status: "success";
      campaignId: string;
      sent: number;
      failed: number;
      cost: number;
    }
  | { status: "scheduled"; campaignId: string; scheduledAt: string }
  | { status: "blocked"; reason: string }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode"; reason: string };

const SEND_BATCH_SIZE = 100;
/** 한 번에 발송 허용 최대 인원. CLAUDE.md 발송 안전 가드. */
const MAX_RECIPIENTS_PER_CAMPAIGN = 10_000;

type SupabaseSrv = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export async function sendCampaign(
  input: SendCampaignInput,
): Promise<SendCampaignResult> {
  // 1) dev-seed 모드 차단 (DB 쓰기 불가)
  if (isDevSeedMode()) {
    return {
      status: "dev_seed_mode",
      reason: "개발 시드 모드에서는 실제 발송이 차단됩니다",
    };
  }

  // 2) 그룹 + 권한 검사
  const group = await getGroup(input.groupId);
  if (!group) {
    return { status: "failed", reason: "존재하지 않는 그룹입니다" };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { status: "failed", reason: "로그인 후 이용 가능합니다" };
  }
  if (!can(user, "send", "campaign", group.branch)) {
    return {
      status: "failed",
      reason: "본 분원 캠페인 발송 권한이 없습니다",
    };
  }

  // 3) 미리보기 (가드 적용 + 비용)
  let preview: PreviewResult;
  try {
    preview = await previewRecipients({
      groupId: input.groupId,
      body: input.body,
      isAd: input.isAd,
      type: input.type,
      scheduledAt: input.scheduledAt ?? new Date(),
    });
  } catch (e) {
    const reason =
      e instanceof Error ? e.message : "미리보기 산출에 실패했습니다";
    return { status: "failed", reason };
  }

  // 야간 광고 차단
  if (preview.blockedByQuietHours) {
    return {
      status: "blocked",
      reason: preview.blockReason ?? "야간 광고 차단 시간대입니다",
    };
  }

  // 수신자 0명
  if (preview.recipientCount === 0) {
    return { status: "failed", reason: "발송 가능한 수신자가 없습니다" };
  }

  // 발송 상한
  if (preview.recipientCount > MAX_RECIPIENTS_PER_CAMPAIGN) {
    return {
      status: "failed",
      reason: `1회 발송 상한(${MAX_RECIPIENTS_PER_CAMPAIGN}건)을 초과했습니다`,
    };
  }

  const supabase = await createSupabaseServerClient();

  // 4) 예약 발송 처리 (campaigns 만 INSERT)
  if (input.scheduledAt !== null) {
    return await insertScheduledCampaign({
      supabase,
      input,
      branch: group.branch,
      preview,
      userId: user.user_id,
    });
  }

  // 5) 즉시 발송
  return await runImmediateSend({
    supabase,
    input,
    branch: group.branch,
    preview,
    userId: user.user_id,
  });
}

// ─── 즉시 발송 ──────────────────────────────────────────────

async function runImmediateSend(args: {
  supabase: SupabaseSrv;
  input: SendCampaignInput;
  branch: string;
  preview: PreviewResult;
  userId: string;
}): Promise<SendCampaignResult> {
  const { supabase, input, branch, preview, userId } = args;

  // a) eligible 수신자 재조회 (preview 는 5명 샘플만 보존하므로)
  const eligible = await reloadEligibleRecipients({
    groupId: input.groupId,
    body: input.body,
    isAd: input.isAd,
    scheduledAt: new Date(),
  });

  if (eligible.length === 0) {
    return { status: "failed", reason: "수신자 목록이 비었습니다" };
  }

  // b) campaigns INSERT (status=발송중)
  const campaignInsert: Record<string, unknown> = {
    title: input.title,
    template_id: input.templateId,
    group_id: input.groupId,
    scheduled_at: null,
    sent_at: new Date().toISOString(),
    status: "발송중",
    total_recipients: eligible.length,
    total_cost: 0, // 발송 직후 갱신
    created_by: userId,
    branch,
    is_test: input.isTest,
  };

  const insertedCampaign = await insertCampaign(supabase, campaignInsert);
  if (!insertedCampaign.ok) {
    return { status: "failed", reason: insertedCampaign.reason };
  }
  const campaignId = insertedCampaign.id;

  // c) messages 일괄 INSERT (status=대기)
  const messagesInsert = eligible.map((r) => ({
    campaign_id: campaignId,
    student_id: r.studentId,
    phone: r.phone,
    status: "대기",
    vendor_message_id: null,
    cost: 0,
    sent_at: null,
    delivered_at: null,
    failed_reason: null,
    is_test: input.isTest,
  }));

  const inserted = await insertMessages(supabase, messagesInsert);
  if (!inserted.ok) {
    await safeUpdateCampaignStatus(supabase, campaignId, "실패", 0);
    return { status: "failed", reason: inserted.reason };
  }

  // d) 어댑터 호출 (batch=100)
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

  for (let i = 0; i < inserted.rows.length; i += SEND_BATCH_SIZE) {
    const batch = inserted.rows.slice(i, i + SEND_BATCH_SIZE);

    const sendResults = await Promise.allSettled(
      batch.map((m) =>
        adapter.send({
          to: m.phone,
          body: preview.finalBody,
          subject: input.subject,
          type: input.type,
          fromNumber,
        }),
      ),
    );

    for (let j = 0; j < batch.length; j += 1) {
      const row = batch[j];
      if (!row) continue;
      const sr = sendResults[j];
      const nowIso = new Date().toISOString();

      if (sr && sr.status === "fulfilled" && sr.value.status === "queued") {
        sentOk += 1;
        const unitCost = calculateCost(input.type, 1).totalCost;
        totalCost += unitCost;
        await updateMessage(supabase, row.id, {
          status: "발송됨",
          vendor_message_id: sr.value.vendorMessageId,
          cost: unitCost,
          sent_at: nowIso,
        });
      } else {
        failed += 1;
        const reason = extractFailedReason(sr);
        await updateMessage(supabase, row.id, {
          status: "실패",
          failed_reason: reason,
          sent_at: nowIso,
        });
      }
    }
  }

  // e) 캠페인 최종 상태 갱신 (부분 실패는 '완료' + failed_count 로 표현)
  const finalStatus = failed === inserted.rows.length ? "실패" : "완료";
  await safeUpdateCampaignStatus(supabase, campaignId, finalStatus, totalCost);

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${campaignId}`);

  return {
    status: "success",
    campaignId,
    sent: sentOk,
    failed,
    cost: totalCost,
  };
}

// ─── 예약 발송 ──────────────────────────────────────────────

async function insertScheduledCampaign(args: {
  supabase: SupabaseSrv;
  input: SendCampaignInput;
  branch: string;
  preview: PreviewResult;
  userId: string;
}): Promise<SendCampaignResult> {
  const { supabase, input, branch, preview, userId } = args;
  const scheduledAt = input.scheduledAt;
  if (!scheduledAt) {
    return { status: "failed", reason: "예약 시각이 비어 있습니다" };
  }

  const insertPayload: Record<string, unknown> = {
    title: input.title,
    template_id: input.templateId,
    group_id: input.groupId,
    scheduled_at: scheduledAt.toISOString(),
    sent_at: null,
    status: "예약됨",
    total_recipients: preview.recipientCount,
    total_cost: 0,
    created_by: userId,
    branch,
    is_test: false,
  };

  const inserted = await insertCampaign(supabase, insertPayload);
  if (!inserted.ok) {
    return { status: "failed", reason: inserted.reason };
  }

  revalidatePath("/campaigns");
  return {
    status: "scheduled",
    campaignId: inserted.id,
    scheduledAt: scheduledAt.toISOString(),
  };
}

// ─── eligible 수신자 재조회 (preview 와 동일 가드 적용) ─────────

interface EligibleRecipient {
  studentId: string | null;
  phone: string;
  name: string;
}

async function reloadEligibleRecipients(args: {
  groupId: string;
  body: string;
  isAd: boolean;
  scheduledAt: Date;
}): Promise<EligibleRecipient[]> {
  // 후보 전체 수집 (페이지 50건씩)
  const collected: Recipient[] = [];
  let page = 1;
  for (;;) {
    const res = await listGroupStudents(args.groupId, { page });
    for (const r of res.items) {
      if (!r.parent_phone) continue;
      collected.push({
        studentId: r.id,
        phone: r.parent_phone.replace(/\D/g, ""),
        name: r.name,
        // listGroupStudents 가 탈퇴를 사전 제외하므로 안전
        status: r.status,
      });
      if (collected.length >= MAX_RECIPIENTS_PER_CAMPAIGN) break;
    }
    if (
      res.items.length === 0 ||
      collected.length >= res.total ||
      collected.length >= MAX_RECIPIENTS_PER_CAMPAIGN
    ) {
      break;
    }
    page += 1;
    if (page > 1000) break; // 안전 가드
  }

  // unsubscribes 조회
  let unsubscribedPhones: string[] = [];
  if (!isDevSeedMode()) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("unsubscribes")
      .select("phone");
    if (error) {
      throw new Error(`수신거부 목록 조회에 실패했습니다: ${error.message}`);
    }
    unsubscribedPhones = (data ?? [])
      .map((r) => (r as { phone: string }).phone)
      .filter((v): v is string => typeof v === "string" && v.length > 0);
  }

  const guarded = applyAllGuards({
    body: args.body,
    isAd: args.isAd,
    scheduledAt: args.scheduledAt,
    recipients: collected,
    unsubscribedPhones,
  });

  return guarded.eligible.map((r) => ({
    studentId: r.studentId,
    phone: r.phone,
    name: r.name,
  }));
}

// ─── DB IO 헬퍼 (좁은 cast) ────────────────────────────────

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

type MessagesInsertReturn =
  | { ok: true; rows: { id: string; phone: string }[] }
  | { ok: false; reason: string };

async function insertMessages(
  supabase: SupabaseSrv,
  rows: Record<string, unknown>[],
): Promise<MessagesInsertReturn> {
  const { data, error } = await (
    supabase.from("messages") as unknown as {
      insert: (v: Record<string, unknown>[]) => {
        select: (cols: string) => Promise<{
          data: { id: string; phone: string }[] | null;
          error: { message: string } | null;
        }>;
      };
    }
  )
    .insert(rows)
    .select("id, phone");

  if (error) {
    return { ok: false, reason: `메시지 큐 적재 실패: ${error.message}` };
  }
  return { ok: true, rows: data ?? [] };
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
  status: "발송중" | "완료" | "실패" | "예약됨" | "취소" | "임시저장",
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

// ─── 기타 헬퍼 ──────────────────────────────────────────────

function readFromNumber(adapterName: string): string | null {
  // 어댑터 이름별 발신번호 환경변수 매핑.
  // 어댑터 자체가 mock 모드여도 fromNumber 는 형식상 필요.
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
