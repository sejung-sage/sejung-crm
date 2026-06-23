/**
 * 예약 발송 디스패처 (cron).
 *
 * 두 종류의 '예약됨' 캠페인을 예약 시각(scheduled_at) 도래 시 처리한다:
 *
 *  1) sendon 네이티브 예약 (30분 이상 예약): 적재 시 drain 이 sendon reservation 으로
 *     이미 접수했고 messages 는 '발송됨' 상태다(대기 없음). sendon 이 그 시각에 발송하므로
 *     cron 은 '완료' 로 상태만 정리한다(이중 발송 방지).
 *
 *  2) 자체 지연발송 (5~30분 예약): sendon 이 30분 미만 예약을 거부하므로 적재 시
 *     '예약됨' + '대기' 로 두고 발송을 미뤘다. cron 이 시각 도래 시 '발송중' 으로 전환하고
 *     drain 을 킥해 즉시 발송한다.
 *
 * 구분: '대기' 메시지가 남아 있으면 자체 지연발송(2), 없으면 네이티브(1).
 *
 * 이중 발송 방지:
 *   - '예약됨' → '발송중' 전환을 status='예약됨' 조건부 UPDATE 로 수행(동시 cron 안전).
 *   - drain 은 '발송중' 인 캠페인만, '대기' 메시지만 발송하므로 재킥해도 idempotent.
 *   - 한 번 '발송중' 으로 넘어가면 다음 cron 은 '예약됨' 이 아니라 다시 집지 않는다.
 *
 * drain 킥은 본 함수가 아니라 호출자(cron route)가 waitUntil 로 fire-and-forget 한다.
 * (drain 한 번에 최대 ~180초 동기 처리라 cron 함수가 await 하면 타임아웃 위험.)
 * 본 함수는 발송중으로 전환한 캠페인 id 목록(started)을 반환하고, route 가 그걸 킥한다.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";

export interface DispatchResult {
  /** sendon 네이티브 예약을 '완료' 로 정리한 캠페인 수. */
  finalized: number;
  /** 자체 지연발송으로 '발송중' 전환한 캠페인 id 목록 (route 가 drain 킥). */
  started: string[];
}

type SrvClient = ReturnType<typeof createSupabaseServiceClient>;

export async function dispatchScheduledCampaigns(): Promise<DispatchResult> {
  if (isDevSeedMode()) {
    return { finalized: 0, started: [] };
  }

  const supabase = createSupabaseServiceClient();
  const nowIso = new Date().toISOString();

  // 예약 시각이 지난 '예약됨' 캠페인 목록.
  const { data, error } = await supabase
    .from("crm_campaigns")
    .select("id")
    .eq("status", "예약됨")
    .lte("scheduled_at", nowIso);

  if (error) {
    throw new Error(`예약 캠페인 조회 실패: ${error.message}`);
  }

  const due = (data ?? []) as Array<{ id: string }>;
  let finalized = 0;
  const started: string[] = [];

  for (const c of due) {
    if (await hasPendingMessages(supabase, c.id)) {
      // 자체 지연발송 → '발송중' 전환(조건부). drain 킥은 route 가 한다.
      const ok = await markSending(supabase, c.id, nowIso);
      if (ok) started.push(c.id);
    } else {
      // sendon 네이티브 예약 → '완료' 정리.
      await markStatus(supabase, c.id, "완료");
      finalized += 1;
    }
  }

  return { finalized, started };
}

/** 캠페인에 '대기' 메시지가 남아 있는지 (자체 지연발송 판별). */
async function hasPendingMessages(
  supabase: SrvClient,
  campaignId: string,
): Promise<boolean> {
  const { count, error } = await supabase
    .from("crm_messages")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", "대기");
  if (error) {
    throw new Error(`대기 메시지 카운트 실패: ${error.message}`);
  }
  return (count ?? 0) > 0;
}

/** '예약됨' → '발송중' 조건부 전환. 이미 다른 인스턴스가 전환했으면 false. */
async function markSending(
  supabase: SrvClient,
  campaignId: string,
  nowIso: string,
): Promise<boolean> {
  const { data, error } = await (
    supabase.from("crm_campaigns") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (
          c: string,
          v: string,
        ) => {
          eq: (
            c: string,
            v: string,
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
    .update({ status: "발송중", sent_at: nowIso })
    .eq("id", campaignId)
    .eq("status", "예약됨")
    .select("id");

  if (error) {
    throw new Error(`예약 캠페인 발송 전환 실패: ${error.message}`);
  }
  return (data?.length ?? 0) > 0;
}

async function markStatus(
  supabase: SrvClient,
  campaignId: string,
  status: string,
): Promise<void> {
  const { error } = await (
    supabase.from("crm_campaigns") as unknown as {
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
  if (error) {
    throw new Error(`예약 캠페인 상태 정리 실패: ${error.message}`);
  }
}
