/**
 * 캠페인 발송 실패 Slack 알림 (캠페인당 1회, dedup).
 *
 * 두 경로가 공유한다:
 *   - 발송 시점 실패 (drain 마감 시 우리 DB '실패' 존재)        → source: "send"
 *   - sendon 비동기 실패 (cron 이 sendon 측 실제 결과를 대조)   → source: "sendon"
 *
 * dedup: crm_campaigns.sendon_failure_alerted_at 를 NULL → now() 로 조건부 선점
 * (먼저 선점한 호출만 Slack 전송). 두 경로가 동시에 떠도 1회만 나간다.
 *
 * service 클라이언트로 호출한다(cron/drain 모두 사용자 세션 없음). throw 하지 않는다.
 */

import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import { postSlackMessage, isSlackEnabled } from "@/lib/notify/slack";
import { getMessagingBaseUrl } from "./base-url";

type SrvClient = ReturnType<typeof createSupabaseServiceClient>;

export interface CampaignFailureAlert {
  campaignId: string;
  title: string;
  branch: string;
  /** 실패 건수. */
  failedCount: number;
  /** 대표 실패 사유(있으면). 예: "포인트 부족". */
  reason?: string;
  /** 감지 경로. */
  source: "send" | "sendon";
}

/**
 * 실패 알림 전송(중복 방지). Slack 미설정이면 no-op.
 * @returns 실제로 알림을 보냈으면 true.
 */
export async function notifyCampaignFailure(
  supabase: SrvClient,
  alert: CampaignFailureAlert,
): Promise<boolean> {
  if (!isSlackEnabled()) return false;
  if (alert.failedCount <= 0) return false;

  // 1) dedup 선점 — alerted_at 이 NULL 인 경우에만 now() 로 갱신.
  const nowIso = new Date().toISOString();
  const { data: claimed, error } = (await (
    supabase.from("crm_campaigns") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (
          c: string,
          v: string,
        ) => {
          is: (
            c: string,
            v: null,
          ) => {
            select: (cols: string) => Promise<{
              data: { id: string }[] | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    }
  )
    .update({ sendon_failure_alerted_at: nowIso })
    .eq("id", alert.campaignId)
    .is("sendon_failure_alerted_at", null)
    .select("id")) as {
    data: { id: string }[] | null;
    error: { message: string } | null;
  };

  // 이미 알렸거나(0행) 갱신 실패면 전송하지 않는다.
  if (error || !claimed || claimed.length === 0) return false;

  // 2) Slack 메시지 구성 + 전송.
  const link = `${getMessagingBaseUrl()}/campaigns/${alert.campaignId}`;
  const sourceLabel =
    alert.source === "sendon" ? "sendon 점검" : "발송 시점";
  const reasonLine = alert.reason ? ` · 사유: ${alert.reason}` : "";
  const text =
    `🔴 *문자 발송 실패* — ${alert.branch} (${sourceLabel})\n` +
    `*${alert.title}*\n` +
    `실패 ${alert.failedCount.toLocaleString()}건${reasonLine}\n` +
    `<${link}|캠페인 상세 열기>`;

  const res = await postSlackMessage(text);
  return res.ok;
}
