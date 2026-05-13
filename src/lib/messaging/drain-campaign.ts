/**
 * 캠페인 드레인 워커.
 *
 * 한 캠페인의 status='대기' 메시지를 청크 단위로 발송한다. 한 청크는 1,000건
 * (PostgREST max_rows cap 동일), 한 호출 안에서 여러 청크를 time budget 안에서
 * 연속 처리해 Vercel 함수 1 호출로 최대 ~50K 건까지 처리한다.
 *
 * API route(`/api/messaging/drain`) 가 본 함수를 호출하고, 다 처리하지 못해
 * `hasMore=true` 가 돌아오면 자기 자신을 fire-and-forget 으로 재호출.
 *
 * 동작 (Vercel 300s 타임아웃 안):
 *   - 청크당: PostgREST `max_rows` = 1,000 으로 다음 '대기' 1,000건 fetch
 *   - 어댑터 호출: sendon batch API 1회 (1,000명을 1요청으로 적재)
 *   - DB UPDATE: 50건 Promise.all 병렬
 *   - 한 청크 예상 처리 시간 ≈ 2~5초
 *   - MAX_BATCHES_PER_INVOCATION × ≈3초 ≤ TIME_BUDGET_MS 가 되도록 튜닝.
 *
 * 왜 한 호출에서 여러 청크를 처리하는가:
 *   self-invocation chain (waitUntil + keepalive) 이 Vercel 환경에서 일정
 *   횟수 이상 연속되면 끊기는 회귀 발견 (2026-05-13 60K 캠페인이 4 청크만에
 *   정지). 한 호출이 더 많이 처리할수록 chain 호출 횟수가 줄어 안정적이고,
 *   "이어보내기" 버튼/sweep 도 1회 호출로 더 많은 분량을 복구할 수 있다.
 *
 * 동시성:
 *   - 같은 캠페인을 두 인스턴스가 동시에 드레인하면 같은 메시지가 두 번 발송될 수 있다.
 *   - 현재 운영은 self-invocation 직렬 (이전 청크가 끝나야 다음 청크 호출) → 충돌 위험 낮음.
 *   - 강한 원자성이 필요하면 RPC SQL 함수에서 FOR UPDATE SKIP LOCKED 로 가져와야 함 (Phase 1).
 *
 * 권한:
 *   - service role 클라이언트 사용. RLS 우회. 호출자(API route) 에서 인증 확인.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { createSmsAdapter } from "./adapters";
import { insertAdTag } from "./guards/insert-ad-tag";
import { insertUnsubscribeFooter } from "./guards/insert-unsubscribe-footer";
import { calculateCost } from "./calculate-cost";
import type {
  CampaignRow,
  CampaignStatus,
  MessageStatus,
  TemplateType,
} from "@/types/database";

const UPDATE_PARALLELISM = 50;
/** PostgREST max_rows cap. 한 fetchPending 가 가져오는 '대기' 메시지 수 = 한 batch
 *  sendon 호출의 수신자 수. */
export const DRAIN_CHUNK_SIZE = 1_000;
/** 한 drain 호출에서 처리할 최대 청크 수. 50청크 × 1,000건 = 50,000건. */
const MAX_BATCHES_PER_INVOCATION = 50;
/** 한 drain 호출의 sendon 발송 작업 time budget. Vercel maxDuration=300s 의 80%.
 *  남은 시간은 응답 송출 + waitUntil 안전 마진. */
const TIME_BUDGET_MS = 240_000;

type SrvClient = SupabaseClient;

export interface DrainChunkResult {
  campaignId: string;
  /** 본 호출에서 발송 시도한 메시지 수 */
  attempted: number;
  /** 본 호출에서 성공한 메시지 수 */
  sent: number;
  /** 본 호출에서 실패한 메시지 수 */
  failed: number;
  /** 본 청크 이후에도 '대기' 메시지가 남았는지 */
  hasMore: boolean;
  /** 본 호출에서 누적된 비용 (campaigns.total_cost 에 이미 반영됨) */
  addedCost: number;
  /** 캠페인 최종 상태가 본 호출에서 마감되었는지 */
  campaignDone: boolean;
}

export async function drainCampaignChunk(
  campaignId: string,
): Promise<DrainChunkResult> {
  const supabase = createSupabaseServiceClient();

  // 1) 캠페인 로드 + 상태 검증
  const campaign = await loadCampaign(supabase, campaignId);
  if (campaign.status !== "발송중") {
    return doneResult(campaignId);
  }
  if (!campaign.body || !campaign.type) {
    await updateCampaignStatus(supabase, campaignId, "실패");
    throw new Error("캠페인 body/type 누락 — 발송 불가");
  }

  // 2) 본문 가드 + 어댑터 + 발신번호 (반복 호출 전 1회만 준비)
  const finalBody = insertUnsubscribeFooter(
    insertAdTag(campaign.body, campaign.is_ad),
    campaign.is_ad,
  );
  const adapter = createSmsAdapter();
  const fromNumber = readFromNumber(adapter.name);
  if (!fromNumber) {
    await updateCampaignStatus(supabase, campaignId, "실패");
    throw new Error("발신번호 환경변수가 설정되어 있지 않습니다");
  }
  const type = campaign.type as TemplateType;

  // 3) 본 호출에서 누적 카운트
  let totalAttempted = 0;
  let totalSent = 0;
  let totalFailed = 0;
  let totalAddedCost = 0;
  const t0 = Date.now();

  // 4) 청크 루프 — time budget / MAX_BATCHES 가 다 차면 break, 그 외엔 끝까지
  for (let batchIdx = 0; batchIdx < MAX_BATCHES_PER_INVOCATION; batchIdx += 1) {
    if (Date.now() - t0 > TIME_BUDGET_MS) break;

    const pending = await fetchPending(supabase, campaignId);
    if (pending.length === 0) break; // 더 처리할 게 없음

    const result = await processOneBatch({
      supabase,
      pending,
      adapter,
      finalBody,
      subject: campaign.subject,
      type,
      fromNumber,
      campaignId,
    });
    totalAttempted += result.attempted;
    totalSent += result.sent;
    totalFailed += result.failed;
    totalAddedCost += result.addedCost;
  }

  // 5) 남은 '대기' 있는지 확인 → hasMore 결정
  const hasMore = await hasPending(supabase, campaignId);

  let campaignDone = false;
  if (!hasMore) {
    const finalStatus = await determineFinalStatus(supabase, campaignId);
    await updateCampaignStatus(supabase, campaignId, finalStatus);
    campaignDone = true;
  }

  return {
    campaignId,
    attempted: totalAttempted,
    sent: totalSent,
    failed: totalFailed,
    hasMore,
    addedCost: totalAddedCost,
    campaignDone,
  };
}

/**
 * 한 청크(최대 1,000건) 처리 — sendon batch 1회 + DB UPDATE.
 * drainCampaignChunk 의 루프 안에서 반복 호출된다.
 */
async function processOneBatch(args: {
  supabase: SrvClient;
  pending: Array<{ id: string; phone: string }>;
  adapter: ReturnType<typeof createSmsAdapter>;
  finalBody: string;
  subject: string | null;
  type: TemplateType;
  fromNumber: string;
  campaignId: string;
}): Promise<{
  attempted: number;
  sent: number;
  failed: number;
  addedCost: number;
}> {
  const { supabase, pending, adapter, finalBody, subject, type, fromNumber, campaignId } =
    args;

  const nowIso = new Date().toISOString();
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  let sent = 0;
  let failed = 0;
  let addedCost = 0;

  const batchResult = await adapter.sendBatch({
    to: pending.map((p) => p.phone),
    body: finalBody,
    subject,
    type,
    fromNumber,
  });

  if (batchResult.status === "queued") {
    sent = pending.length;
    const totalCost = calculateCost(type, pending.length).totalCost;
    addedCost = totalCost;
    const perRowCost = Math.round(batchResult.unitCost);
    for (const row of pending) {
      updates.push({
        id: row.id,
        patch: {
          status: "발송됨" satisfies MessageStatus,
          vendor_message_id: batchResult.vendorMessageId,
          cost: perRowCost,
          sent_at: nowIso,
        },
      });
    }
  } else {
    failed = pending.length;
    const failedReason = batchResult.reason;
    for (const row of pending) {
      updates.push({
        id: row.id,
        patch: {
          status: "실패" satisfies MessageStatus,
          failed_reason: failedReason,
          sent_at: nowIso,
        },
      });
    }
  }

  // UPDATE 병렬 적용
  for (let i = 0; i < updates.length; i += UPDATE_PARALLELISM) {
    const wave = updates.slice(i, i + UPDATE_PARALLELISM);
    await Promise.all(wave.map((u) => updateMessage(supabase, u.id, u.patch)));
  }

  if (addedCost > 0) {
    await incrementCampaignCost(supabase, campaignId, addedCost);
  }

  return { attempted: pending.length, sent, failed, addedCost };
}

// ─── 헬퍼 ──────────────────────────────────────────────────

function doneResult(campaignId: string): DrainChunkResult {
  return {
    campaignId,
    attempted: 0,
    sent: 0,
    failed: 0,
    hasMore: false,
    addedCost: 0,
    campaignDone: true,
  };
}

async function loadCampaign(
  supabase: SrvClient,
  campaignId: string,
): Promise<CampaignRow> {
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();

  if (error) throw new Error(`캠페인 조회 실패: ${error.message}`);
  if (!data) throw new Error(`존재하지 않는 캠페인: ${campaignId}`);
  return data as CampaignRow;
}

async function fetchPending(
  supabase: SrvClient,
  campaignId: string,
): Promise<Array<{ id: string; phone: string }>> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, phone")
    .eq("campaign_id", campaignId)
    .eq("status", "대기")
    .order("id", { ascending: true })
    .limit(DRAIN_CHUNK_SIZE);

  if (error) throw new Error(`대기 메시지 조회 실패: ${error.message}`);
  return (data ?? []) as Array<{ id: string; phone: string }>;
}

async function hasPending(
  supabase: SrvClient,
  campaignId: string,
): Promise<boolean> {
  const { count, error } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", "대기");

  if (error) throw new Error(`남은 대기 카운트 실패: ${error.message}`);
  return (count ?? 0) > 0;
}

async function determineFinalStatus(
  supabase: SrvClient,
  campaignId: string,
): Promise<"완료" | "실패"> {
  // 발송됨이 1건이라도 있으면 '완료' (부분 실패 포함). 전부 실패면 '실패'.
  const { count: okCount, error } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", "발송됨");

  if (error) throw new Error(`최종 상태 산출 실패: ${error.message}`);
  return (okCount ?? 0) > 0 ? "완료" : "실패";
}

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
  status: CampaignStatus,
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
    .update({ status })
    .eq("id", campaignId);
}

async function incrementCampaignCost(
  supabase: SrvClient,
  campaignId: string,
  added: number,
): Promise<void> {
  // race 발생 가능하나 self-invocation 직렬이라 위험 낮음. 강한 원자성 필요 시 RPC 로 이전.
  const { data } = await supabase
    .from("campaigns")
    .select("total_cost")
    .eq("id", campaignId)
    .maybeSingle();

  const cur = (data as { total_cost?: number } | null)?.total_cost ?? 0;
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
    .update({ total_cost: Math.round(cur + added) })
    .eq("id", campaignId);
}

function readFromNumber(adapterName: string): string | null {
  switch (adapterName) {
    case "sendon":
      return process.env.SENDON_FROM_NUMBER ?? "01000000000";
    default:
      return null;
  }
}

