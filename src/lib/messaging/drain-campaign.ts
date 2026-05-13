/**
 * 캠페인 드레인 워커.
 *
 * 한 캠페인의 status='대기' 메시지 다음 청크(최대 DRAIN_CHUNK_SIZE 건) 를 발송하고,
 * messages.status / cost / vendor_message_id 를 갱신한 뒤, 더 남은 '대기' 가 있는지
 * 응답한다.
 *
 * API route(`/api/messaging/drain`) 가 본 함수를 호출하고, `hasMore=true` 면
 * 자기 자신을 fire-and-forget 으로 재호출해 다음 청크를 이어 발송한다.
 *
 * Vercel 함수 타임아웃(300s) 안에 한 청크가 안전하게 끝나도록 설계:
 *   - DRAIN_CHUNK_SIZE = 1,000
 *   - 어댑터 호출: 100건 Promise.allSettled batch
 *   - DB UPDATE: 50건 Promise.all 병렬 (라운드트립 단축)
 *   - 한 청크 예상 처리 시간 ≈ 20~40초
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
import type { SmsSendResult } from "./adapters/types";
import type {
  CampaignRow,
  CampaignStatus,
  MessageStatus,
  TemplateType,
} from "@/types/database";

const SEND_BATCH = 100;
const UPDATE_PARALLELISM = 50;
/** 한 드레인 호출에서 처리할 최대 메시지 수. Vercel 300s 한도 내 안전 마진. */
export const DRAIN_CHUNK_SIZE = 1_000;

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

  // 2) 다음 청크 가져오기 (오래된 순)
  const pending = await fetchPending(supabase, campaignId);

  if (pending.length === 0) {
    // 더 발송할 게 없음 — 캠페인 마감
    const finalStatus = await determineFinalStatus(supabase, campaignId);
    await updateCampaignStatus(supabase, campaignId, finalStatus);
    return doneResult(campaignId);
  }

  // 3) 최종 본문 재계산 (광고 prefix + 080 footer)
  const finalBody = insertUnsubscribeFooter(
    insertAdTag(campaign.body, campaign.is_ad),
    campaign.is_ad,
  );

  // 4) 어댑터 + 발신번호
  const adapter = createSmsAdapter();
  const fromNumber = readFromNumber(adapter.name);
  if (!fromNumber) {
    await updateCampaignStatus(supabase, campaignId, "실패");
    throw new Error("발신번호 환경변수가 설정되어 있지 않습니다");
  }

  // 5) 발송 (batch=100)
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  let sent = 0;
  let failed = 0;
  let addedCost = 0;
  const type = campaign.type as TemplateType;

  for (let i = 0; i < pending.length; i += SEND_BATCH) {
    const batch = pending.slice(i, i + SEND_BATCH);
    const results = await Promise.allSettled(
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
      const sr = results[j];
      const nowIso = new Date().toISOString();

      if (sr && sr.status === "fulfilled" && sr.value.status === "queued") {
        sent += 1;
        const unitCost = calculateCost(type, 1).totalCost;
        addedCost += unitCost;
        // messages.cost INT — 소수 단가는 round 후 저장 (합산 정확도는 totalCost float 누적으로 보존).
        updates.push({
          id: row.id,
          patch: {
            status: "발송됨" satisfies MessageStatus,
            vendor_message_id: sr.value.vendorMessageId,
            cost: Math.round(unitCost),
            sent_at: nowIso,
          },
        });
      } else {
        failed += 1;
        updates.push({
          id: row.id,
          patch: {
            status: "실패" satisfies MessageStatus,
            failed_reason: extractFailedReason(sr),
            sent_at: nowIso,
          },
        });
      }
    }
  }

  // 6) UPDATE 병렬 적용 (50건씩 묶어 라운드트립 단축)
  for (let i = 0; i < updates.length; i += UPDATE_PARALLELISM) {
    const wave = updates.slice(i, i + UPDATE_PARALLELISM);
    await Promise.all(wave.map((u) => updateMessage(supabase, u.id, u.patch)));
  }

  // 7) 캠페인 누적 비용 갱신
  if (addedCost > 0) {
    await incrementCampaignCost(supabase, campaignId, addedCost);
  }

  // 8) 남은 '대기' 있는지 확인 → hasMore 결정
  const hasMore = await hasPending(supabase, campaignId);

  let campaignDone = false;
  if (!hasMore) {
    const finalStatus = await determineFinalStatus(supabase, campaignId);
    await updateCampaignStatus(supabase, campaignId, finalStatus);
    campaignDone = true;
  }

  return {
    campaignId,
    attempted: pending.length,
    sent,
    failed,
    hasMore,
    addedCost,
    campaignDone,
  };
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
