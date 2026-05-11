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
import { waitUntil } from "@vercel/functions";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { applyAllGuards, type Recipient } from "./guards";
import { getMessagingBaseUrl } from "./base-url";
import { loadAllGroupRecipients } from "@/lib/groups/load-all-group-recipients";
import type { CampaignRow, MessageStatus, TemplateType } from "@/types/database";

const MAX_RECIPIENTS_PER_CAMPAIGN = 100_000;
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

  // 4) messages 청크 INSERT (1,000건 청크 — 대량 캠페인 대비)
  const MESSAGES_INSERT_CHUNK = 1_000;
  for (let i = 0; i < eligible.recipients.length; i += MESSAGES_INSERT_CHUNK) {
    const slice = eligible.recipients.slice(i, i + MESSAGES_INSERT_CHUNK);
    const insertPayload = slice.map((r) => ({
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
        insert: (
          v: Record<string, unknown>[],
        ) => Promise<{ error: { message: string } | null }>;
      }
    ).insert(insertPayload);

    if (insertRes.error) {
      await markCampaignFailed(
        supabase,
        campaignId,
        `메시지 큐 적재 실패: ${insertRes.error.message}`,
      );
      return {
        campaignId,
        status: "failed",
        reason: insertRes.error.message,
      };
    }
  }

  // 5) 드레인 워커 킥 — 실제 발송은 self-invocation 워커가 청크씩 처리.
  //    campaigns.status='발송중' 유지, total_cost 는 드레인이 누적 갱신.
  kickDrainWorker(campaignId);

  return {
    campaignId,
    status: "sent",
    sent: eligible.recipients.length,
    failed: 0,
  };
}

function kickDrainWorker(campaignId: string): void {
  const drainSecret = process.env.DRAIN_SECRET;
  if (!drainSecret) {
    // 운영 배포 전 필수. 시크릿이 없으면 캠페인이 '발송중' 으로 멈춰있게 된다.
    console.error("DRAIN_SECRET 미설정 — 드레인 워커를 킥할 수 없습니다");
    return;
  }

  const url = `${getMessagingBaseUrl()}/api/messaging/drain`;
  // Vercel `waitUntil` 로 fetch 가 실제 발사되도록 보장.
  waitUntil(
    fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-drain-secret": drainSecret,
      },
      body: JSON.stringify({ campaignId }),
    }).catch(() => {
      /* fire-and-forget — 운영팀이 수동 재시도로 회복 */
    }),
  );
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
  // 1) 후보 전체 일괄 수집 — SQL 단에서 분원·탈퇴·수신거부 가드까지 처리.
  //    60K 기준 8~10 쿼리로 끝남.
  const rows = await loadAllGroupRecipients(
    args.supabase,
    args.groupId,
    MAX_RECIPIENTS_PER_CAMPAIGN,
  );

  const collected: Recipient[] = [];
  for (const r of rows) {
    if (!r.parent_phone) continue;
    collected.push({
      studentId: r.id,
      phone: r.parent_phone.replace(/\D/g, ""),
      name: r.name,
      status: r.status,
    });
  }

  // 2) 본문 가드 (광고 prefix / 080 footer / 야간 차단) 적용.
  //    수신거부·탈퇴는 SQL 단에서 이미 제외됐으므로 unsubscribedPhones 비워서 호출.
  const guarded = applyAllGuards({
    body: args.body,
    isAd: args.isAd,
    scheduledAt: args.scheduledAt,
    recipients: collected,
    unsubscribedPhones: [],
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

async function markCampaignFailed(
  supabase: SrvClient,
  campaignId: string,
  _reason: string,
): Promise<void> {
  // failed_reason 컬럼이 campaigns 에 없어 messages 단까지만 reason 보존.
  // campaigns.status='실패' 만 박는다.
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
    .update({ status: "실패", total_cost: 0 })
    .eq("id", campaignId);
}

// type guard helper for TemplateType narrowing (re-export safety)
export type { TemplateType };
