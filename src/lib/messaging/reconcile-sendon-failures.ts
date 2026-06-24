/**
 * sendon 비동기 발송 실패 점검 + Slack 알림 (30분 cron).
 *
 * 배경: 발송 접수(200) 후 sendon 이 비동기로 처리 실패(포인트 부족 등)시킨 건은
 * 우리 DB 가 '발송됨' 으로 남아 추적되지 않는다(도달 webhook 미구현). 이 작업이
 * 최근 캠페인의 sendon 측 실제 결과를 대조해 실패가 있으면 Slack 으로 1회 알린다.
 *
 * 대상: 최근 3일 내 생성 + 아직 실패 알림 안 한(sendon_failure_alerted_at IS NULL)
 *       발송/예약 캠페인. (먼 미래 예약은 3일 창을 벗어날 수 있음 — 근시일 예약 기준.)
 *
 * dedup: notifyCampaignFailure 가 alerted_at 컬럼을 선점하므로 발송시점 알림과
 * 중복되지 않고 캠페인당 1회만 나간다.
 *
 * Slack 미설정(SLACK_WEBHOOK_URL 없음)이면 전체 skip.
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
/** 점검 대상 생성 기간(일). */
const LOOKBACK_DAYS = 3;
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
  const sinceIso = new Date(
    Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await supabase
    .from("crm_campaigns")
    .select("id, title, branch")
    .is("sendon_failure_alerted_at", null)
    .in("status", ["완료", "발송중", "예약됨"])
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(MAX_CAMPAIGNS_PER_RUN);

  if (error) {
    throw new Error(`캠페인 점검 대상 조회 실패: ${error.message}`);
  }

  const campaigns = (data ?? []) as Array<{
    id: string;
    title: string;
    branch: string;
  }>;

  let checked = 0;
  let alerted = 0;
  for (const c of campaigns) {
    checked += 1;
    // 분원별 sendon 계정으로 조회 — 캠페인마다 계정이 다를 수 있어 루프 안에서 생성.
    const adapter = createSmsAdapter(c.branch);
    const summary = await summarizeSendonFailures(supabase, adapter, c.id);
    if (summary.failed <= 0) continue;
    const sent = await notifyCampaignFailure(supabase, {
      campaignId: c.id,
      title: c.title,
      branch: c.branch,
      failedCount: summary.failed,
      reason: summary.reason,
      source: "sendon",
    });
    if (sent) alerted += 1;
  }

  return { checked, alerted };
}

/**
 * 캠페인의 sendon 측 실패 건수 합계 + 대표 사유(표본).
 * inspect-campaign-sendon 의 축약 버전 — 카운트와 사유만 모은다.
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
    // 대표 사유 1개만 표본으로 확보(아직 못 구했고 실패가 있는 그룹에서).
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
