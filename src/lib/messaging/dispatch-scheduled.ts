/**
 * 예약 발송 상태 정리 (cron).
 *
 * 2026-06 개편: 예약 발송을 sendon 네이티브 reservation 으로 전환.
 *   - 예약 시점에 drain 이 sendon 에 `reservation.datetime` 으로 접수하고,
 *     캠페인을 '예약됨' 으로 마감한다. 실제 발송은 sendon 이 그 시각에 수행.
 *   - 따라서 cron 은 더 이상 발송하지 않는다(이중 발송 원천 차단).
 *
 * 본 함수는 예약 시각이 지난 '예약됨' 캠페인을 '완료' 로 정리만 한다(상태 hygiene).
 * 메시지 행은 예약 접수 시 이미 '발송됨' + vendor_message_id 로 적재되어 있다.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";

export interface DispatchResult {
  /** '완료' 로 정리된 캠페인 수. */
  finalized: number;
}

export async function dispatchScheduledCampaigns(): Promise<DispatchResult> {
  if (isDevSeedMode()) {
    return { finalized: 0 };
  }

  const supabase = createSupabaseServiceClient();
  const nowIso = new Date().toISOString();

  // 예약 시각이 지난 '예약됨' → sendon 이 그 시각에 발송했으므로 '완료' 로 정리.
  // (발송 자체는 하지 않는다 — sendon reservation 이 담당.)
  const { data, error } = (await (
    supabase.from("crm_campaigns") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (
          c: string,
          v: string,
        ) => {
          lte: (
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
    .update({ status: "완료" })
    .eq("status", "예약됨")
    .lte("scheduled_at", nowIso)
    .select("id")) as {
    data: { id: string }[] | null;
    error: { message: string } | null;
  };

  if (error) {
    throw new Error(`예약 캠페인 상태 정리 실패: ${error.message}`);
  }

  return { finalized: data?.length ?? 0 };
}
