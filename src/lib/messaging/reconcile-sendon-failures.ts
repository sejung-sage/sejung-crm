/**
 * 발송 실패 점검 + Slack 알림 (짧은 주기 cron).
 *
 * 동작: drain 이 발송/예약 접수를 마감하며 sendon_check_due_at = now()+5분 을 찍는다.
 * 이 cron 은 점검 시각이 된(sendon_check_due_at <= now()) 캠페인만 집어, 그 캠페인의
 *   1) 우리 DB '실패'(접수 단계 실패 — 번호오류·배치거부 등)
 *   2) sendon 비동기 실패(접수됐지만 포인트 부족 등으로 처리 실패 — DB 는 '발송됨')
 * 를 합산해 1건이라도 있으면 Slack 으로 캠페인당 1회 알린다.
 *
 * 전체 폴링·백필 없음: 발송이 끝난 캠페인만, 그것도 예약된 1회만 점검한다.
 * claim(due_at → NULL 조건부 갱신)으로 동시 cron 중복 점검을 막는다.
 *
 * Slack 미설정(SLACK_BOT_TOKEN/SLACK_CHANNEL_ID 없음)이면 전체 skip.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { createSmsAdapter } from "./adapters";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { isSlackEnabled } from "@/lib/notify/slack";
import { notifyCampaignFailure } from "./notify-campaign-failure";

export interface ReconcileResult {
  /** 점검한 캠페인 수. */
  checked: number;
  /** 실패가 발견돼 알림을 보낸 캠페인 수. */
  alerted: number;
  /** skip 사유(있으면). */
  skipped?: string;
}

type SrvClient = ReturnType<typeof createSupabaseServiceClient>;

/** 한 번에 점검하는 최대 캠페인 수(호출량·시간 상한). */
const MAX_CAMPAIGNS_PER_RUN = 30;
/** 사유 표본 조회 건수. */
const REASON_SAMPLE = 200;

export async function reconcileSendonFailures(): Promise<ReconcileResult> {
  if (isDevSeedMode()) {
    return { checked: 0, alerted: 0, skipped: "dev-seed" };
  }
  if (!isSlackEnabled()) {
    return { checked: 0, alerted: 0, skipped: "no-webhook" };
  }

  const supabase = createSupabaseServiceClient();
  const nowIso = new Date().toISOString();

  // 점검 시각이 된 캠페인만.
  const { data, error } = await supabase
    .from("crm_campaigns")
    .select("id, title, branch")
    .not("sendon_check_due_at", "is", null)
    .lte("sendon_check_due_at", nowIso)
    .order("sendon_check_due_at", { ascending: true })
    .limit(MAX_CAMPAIGNS_PER_RUN);

  if (error) {
    throw new Error(`점검 대상 조회 실패: ${error.message}`);
  }

  const campaigns = (data ?? []) as Array<{
    id: string;
    title: string;
    branch: string;
  }>;

  let checked = 0;
  let alerted = 0;
  for (const c of campaigns) {
    // claim — due_at 를 NULL 로 비운다(아직 안 비워졌을 때만). 동시 cron 안전 + 1회 점검.
    if (!(await claimCheck(supabase, c.id))) continue;
    checked += 1;

    const dbFailed = await countDbFailures(supabase, c.id);
    // 분원별 sendon 계정으로 조회.
    const sendon = await summarizeSendonFailures(
      supabase,
      createSmsAdapter(c.branch),
      c.id,
    );
    const total = dbFailed.count + sendon.failed;
    if (total <= 0) continue;

    const sent = await notifyCampaignFailure(supabase, {
      campaignId: c.id,
      title: c.title,
      branch: c.branch,
      failedCount: total,
      reason: sendon.failed > 0 ? sendon.reason : dbFailed.reason,
      source: sendon.failed > 0 ? "sendon" : "send",
    });
    if (sent) alerted += 1;
  }

  return { checked, alerted };
}

/** due_at 를 조건부로 비워 점검을 선점. 이미 비워졌으면(다른 cron) false. */
async function claimCheck(
  supabase: SrvClient,
  campaignId: string,
): Promise<boolean> {
  const { data } = (await (
    supabase.from("crm_campaigns") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (
          c: string,
          v: string,
        ) => {
          not: (
            c: string,
            op: string,
            v: null,
          ) => {
            select: (cols: string) => Promise<{
              data: { id: string }[] | null;
            }>;
          };
        };
      };
    }
  )
    .update({ sendon_check_due_at: null })
    .eq("id", campaignId)
    .not("sendon_check_due_at", "is", null)
    .select("id")) as { data: { id: string }[] | null };
  return !!data && data.length > 0;
}

/** 캠페인의 우리 DB '실패'(비-테스트) 건수 + 대표 사유. */
async function countDbFailures(
  supabase: SrvClient,
  campaignId: string,
): Promise<{ count: number; reason?: string }> {
  const { count } = await supabase
    .from("crm_messages")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", "실패")
    .eq("is_test", false);
  const failed = count ?? 0;
  if (failed === 0) return { count: 0 };

  const { data } = await supabase
    .from("crm_messages")
    .select("failed_reason")
    .eq("campaign_id", campaignId)
    .eq("status", "실패")
    .eq("is_test", false)
    .not("failed_reason", "is", null)
    .limit(1);
  const rows = (data ?? []) as Array<{ failed_reason: string | null }>;
  return { count: failed, reason: rows[0]?.failed_reason?.trim() || undefined };
}

/**
 * 캠페인의 sendon 측 실패 건수 합계 + 대표 사유(표본).
 * '발송됨' 인데 sendon 이 비동기로 실패시킨 건(포인트 부족 등)을 잡는다.
 */
async function summarizeSendonFailures(
  supabase: SrvClient,
  adapter: ReturnType<typeof createSmsAdapter>,
  campaignId: string,
): Promise<{ failed: number; reason?: string }> {
  // distinct groupId(vendor_message_id) 수집.
  const groupIds = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("crm_messages")
      .select("vendor_message_id")
      .eq("campaign_id", campaignId)
      .not("vendor_message_id", "is", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { failed: 0 };
    const rows = (data ?? []) as Array<{ vendor_message_id: string | null }>;
    for (const r of rows) {
      if (r.vendor_message_id) groupIds.add(r.vendor_message_id);
    }
    if (rows.length < PAGE) break;
  }
  if (groupIds.size === 0) return { failed: 0 };

  let failed = 0;
  let reason: string | undefined;
  for (const gid of groupIds) {
    const c = await adapter.queryGroupCounts(gid);
    if (!c.ok) continue;
    failed += c.failed;
    if (!reason && c.failed > 0) {
      const list = await adapter.listGroupMessages(gid, "FAILED", REASON_SAMPLE);
      if (list.ok) {
        const found = list.messages.find((m) => m.resultText?.trim());
        if (found) reason = found.resultText.trim();
      }
    }
  }

  return { failed, reason };
}
