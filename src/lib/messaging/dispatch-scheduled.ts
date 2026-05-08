/**
 * 예약 발송 디스패처 — Vercel Cron 에서 호출.
 *
 * 운영 트리거: 매일 KST 11:00 (Vercel Hobby 1일 1회 제약). vercel.json 참고.
 *
 * 흐름:
 *   1) status='예약됨' AND scheduled_at <= NOW() 인 캠페인 조회 (오래된 순)
 *   2) 각 캠페인을 atomic 락 (UPDATE ... WHERE status='예약됨' RETURNING id)
 *      → 동시 cron 인스턴스 / 매뉴얼 발송과의 중복 방지
 *   3) 락 성공한 캠페인의 메시지 일괄 INSERT + 어댑터 호출 (batch=100)
 *   4) campaigns.status / total_cost 갱신
 *
 * 보안:
 *   - service role 클라이언트 사용 (RLS 우회 — cron 은 시스템 동작).
 *   - HTTP 인증은 API route (`/api/cron/dispatch-scheduled-campaigns`) 에서 처리.
 *
 * 안전 가드:
 *   - 야간 광고 차단 — preview 시 통과해도 cron 시점에 다시 검사.
 *     실패 시 status='실패' + failed_reason 으로 마크 (재시도 X — 명백한 정책 위반).
 *   - 1만건 cap 동일.
 *
 * 한 호출에서 처리하는 캠페인 수 = DISPATCH_BATCH_SIZE.
 * 1일 1회 트리거라 누적 캠페인이 많아질 수 있어 30 으로 설정.
 * 캠페인당 평균 5초 가정 시 30개 = 150초 (Vercel default 300s 안에 마감).
 * 처리 못 한 캠페인은 status='예약됨' 유지 → 다음 날 cron 에서 처리.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { createSmsAdapter } from "./adapters";
import { applyAllGuards, type Recipient } from "./guards";
import { calculateCost } from "./calculate-cost";
import { listGroupStudents } from "@/lib/groups/list-group-students";
import type { CampaignRow, MessageStatus, TemplateType } from "@/types/database";

const SEND_BATCH_SIZE = 100;
const MAX_RECIPIENTS_PER_CAMPAIGN = 10_000;
const DISPATCH_BATCH_SIZE = 30; // 한 cron 호출에서 처리할 최대 캠페인 수 (1일 1회 트리거 대응)

export interface DispatchResult {
  ts: string;
  /** 도달한(scheduled_at <= now) 예약 캠페인 후보 수. */
  candidates: number;
  /** 본 호출에서 락+발송 시도까지 끝난 캠페인 수. */
  processed: number;
  /** 락 실패 (다른 인스턴스가 선점) 또는 발송 실패 캠페인 수. */
  skipped: number;
  /** 캠페인 단위 발송 결과 요약 (선택, 디버그용). */
  perCampaign: Array<{
    campaignId: string;
    status: "sent" | "blocked" | "failed" | "locked-out";
    sent?: number;
    failed?: number;
    reason?: string;
  }>;
}

export async function dispatchScheduledCampaigns(): Promise<DispatchResult> {
  const ts = new Date().toISOString();
  const supabase = createSupabaseServiceClient();

  // 1) 도달한 예약 캠페인 조회 (오래된 순)
  const { data: candidates, error } = await supabase
    .from("campaigns")
    .select("id")
    .eq("status", "예약됨")
    .lte("scheduled_at", ts)
    .order("scheduled_at", { ascending: true })
    .limit(DISPATCH_BATCH_SIZE);

  if (error) {
    throw new Error(`예약 캠페인 조회 실패: ${error.message}`);
  }

  const list = (candidates ?? []) as Array<{ id: string }>;
  const result: DispatchResult = {
    ts,
    candidates: list.length,
    processed: 0,
    skipped: 0,
    perCampaign: [],
  };

  for (const c of list) {
    const r = await dispatchOne(supabase, c.id);
    result.perCampaign.push(r);
    if (r.status === "sent") result.processed += 1;
    else result.skipped += 1;
  }

  return result;
}

// ─── 단건 디스패치 ─────────────────────────────────────────

type SrvClient = SupabaseClient;

async function dispatchOne(
  supabase: SrvClient,
  campaignId: string,
): Promise<DispatchResult["perCampaign"][number]> {
  // 2) atomic 락 — UPDATE ... WHERE status='예약됨' RETURNING.
  // 동시 cron 인스턴스가 같은 캠페인을 잡아도 한쪽만 통과.
  const lockRes = await (
    supabase.from("campaigns") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (
          c: string,
          v: string,
        ) => {
          eq: (
            c: string,
            v: string,
          ) => {
            select: (cols: string) => {
              maybeSingle: () => Promise<{
                data: CampaignRow | null;
                error: { message: string } | null;
              }>;
            };
          };
        };
      };
    }
  )
    .update({ status: "발송중", sent_at: new Date().toISOString() })
    .eq("id", campaignId)
    .eq("status", "예약됨")
    .select("*")
    .maybeSingle();

  if (lockRes.error) {
    return {
      campaignId,
      status: "failed",
      reason: `락 시도 실패: ${lockRes.error.message}`,
    };
  }
  if (!lockRes.data) {
    // 다른 인스턴스가 이미 락을 잡고 처리 중 (또는 완료/취소).
    return { campaignId, status: "locked-out" };
  }

  const campaign = lockRes.data;

  // 발송 payload 무결성 검사
  if (!campaign.body || !campaign.type || !campaign.group_id) {
    await markCampaignFailed(
      supabase,
      campaignId,
      "예약 발송 payload 누락 (body/type/group_id)",
    );
    return {
      campaignId,
      status: "failed",
      reason: "예약 발송 payload 누락",
    };
  }

  // 3) eligible 수신자 재조회 + 가드
  const eligible = await loadEligibleForCampaign({
    groupId: campaign.group_id,
    body: campaign.body,
    isAd: campaign.is_ad,
    scheduledAt: new Date(campaign.scheduled_at ?? Date.now()),
    supabase,
  });

  if (eligible.kind === "blocked") {
    await markCampaignFailed(supabase, campaignId, eligible.reason);
    return { campaignId, status: "blocked", reason: eligible.reason };
  }

  if (eligible.recipients.length === 0) {
    await markCampaignFailed(supabase, campaignId, "수신자 0명");
    return { campaignId, status: "failed", reason: "수신자 0명" };
  }

  // 4) messages 일괄 INSERT
  const insertPayload = eligible.recipients.map((r) => ({
    campaign_id: campaignId,
    student_id: r.studentId,
    phone: r.phone,
    status: "대기" as MessageStatus,
    vendor_message_id: null,
    cost: 0,
    sent_at: null,
    delivered_at: null,
    failed_reason: null,
    is_test: campaign.is_test,
  }));

  const insertRes = await (
    supabase.from("messages") as unknown as {
      insert: (v: Record<string, unknown>[]) => {
        select: (cols: string) => Promise<{
          data: { id: string; phone: string }[] | null;
          error: { message: string } | null;
        }>;
      };
    }
  )
    .insert(insertPayload)
    .select("id, phone");

  if (insertRes.error || !insertRes.data) {
    await markCampaignFailed(
      supabase,
      campaignId,
      `메시지 큐 적재 실패: ${insertRes.error?.message ?? "unknown"}`,
    );
    return {
      campaignId,
      status: "failed",
      reason: insertRes.error?.message ?? "메시지 큐 적재 실패",
    };
  }

  // 5) 어댑터 호출 (batch=100)
  const adapter = createSmsAdapter();
  const fromNumber = readFromNumber(adapter.name);
  if (!fromNumber) {
    await markCampaignFailed(supabase, campaignId, "발신번호 환경변수 누락");
    return {
      campaignId,
      status: "failed",
      reason: "발신번호 환경변수 누락",
    };
  }

  const rows = insertRes.data;
  let sentOk = 0;
  let failed = 0;
  let totalCost = 0;
  const finalBody = eligible.finalBody;
  const type = campaign.type;

  for (let i = 0; i < rows.length; i += SEND_BATCH_SIZE) {
    const batch = rows.slice(i, i + SEND_BATCH_SIZE);
    const sendResults = await Promise.allSettled(
      batch.map((m) =>
        adapter.send({
          to: m.phone,
          body: finalBody,
          subject: campaign.subject,
          type,
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
        const unitCost = calculateCost(type, 1).totalCost;
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

  // 6) 캠페인 최종 상태 갱신
  const finalStatus = failed === rows.length ? "실패" : "완료";
  await updateCampaignStatus(supabase, campaignId, finalStatus, totalCost);

  return {
    campaignId,
    status: "sent",
    sent: sentOk,
    failed,
  };
}

// ─── eligible 재조회 + 가드 (cron 시점) ────────────────────

async function loadEligibleForCampaign(args: {
  groupId: string;
  body: string;
  isAd: boolean;
  scheduledAt: Date;
  supabase: SrvClient;
}): Promise<
  | {
      kind: "ok";
      recipients: { studentId: string | null; phone: string; name: string }[];
      finalBody: string;
    }
  | { kind: "blocked"; reason: string }
> {
  // 후보 전체 수집 (페이지 50건)
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
    if (page > 1000) break;
  }

  // unsubscribes
  const { data: unsubData, error: unsubErr } = await args.supabase
    .from("unsubscribes")
    .select("phone");
  if (unsubErr) {
    throw new Error(`수신거부 목록 조회 실패: ${unsubErr.message}`);
  }
  const unsubscribedPhones = ((unsubData ?? []) as Array<{ phone: string }>)
    .map((r) => r.phone)
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  const guarded = applyAllGuards({
    body: args.body,
    isAd: args.isAd,
    scheduledAt: args.scheduledAt,
    recipients: collected,
    unsubscribedPhones,
  });

  if (!guarded.allowedToSend) {
    return {
      kind: "blocked",
      reason:
        guarded.blockReason ?? "야간 광고 차단 시간대 (예약 발송 시점 검사)",
    };
  }

  return {
    kind: "ok",
    recipients: guarded.eligible.map((r) => ({
      studentId: r.studentId,
      phone: r.phone,
      name: r.name,
    })),
    finalBody: guarded.finalBody,
  };
}

// ─── DB 헬퍼 ───────────────────────────────────────────────

async function updateMessage(
  supabase: SrvClient,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await (
    supabase.from("messages") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (
          c: string,
          v: string,
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )
    .update(patch)
    .eq("id", id);
}

async function updateCampaignStatus(
  supabase: SrvClient,
  campaignId: string,
  status: "완료" | "실패",
  totalCost: number,
): Promise<void> {
  await (
    supabase.from("campaigns") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (
          c: string,
          v: string,
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )
    .update({ status, total_cost: totalCost })
    .eq("id", campaignId);
}

async function markCampaignFailed(
  supabase: SrvClient,
  campaignId: string,
  _reason: string,
): Promise<void> {
  // failed_reason 컬럼이 campaigns 에 없어 messages 단까지만 reason 보존.
  // campaigns.status='실패' 만 박는다.
  await updateCampaignStatus(supabase, campaignId, "실패", 0);
}

function readFromNumber(adapterName: string): string | null {
  switch (adapterName) {
    case "solapi":
      return process.env.SOLAPI_FROM_NUMBER ?? "01000000000";
    case "sendon":
      return process.env.SENDON_FROM_NUMBER ?? "01000000000";
    default:
      return null;
  }
}

function extractFailedReason(sr: PromiseSettledResult<unknown> | undefined): string {
  if (!sr) return "어댑터 응답 누락";
  if (sr.status === "rejected") {
    return sr.reason instanceof Error ? sr.reason.message : String(sr.reason);
  }
  // fulfilled 인데 status !== queued
  const v = sr.value as { status: string; reason?: string };
  return v.reason ?? `어댑터 거부 (status=${v.status})`;
}

// type guard helper for TemplateType narrowing (re-export safety)
export type { TemplateType };
