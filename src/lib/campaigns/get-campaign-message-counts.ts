/**
 * 캠페인 진행률 카운트 — 상태별 메시지 건수만 head 쿼리로 산출.
 *
 * 드레인 워커가 동작 중인 동안 캠페인 상세 페이지가 실시간 진행률을 보여주기 위한
 * 경량 쿼리. listCampaignMessages 는 본문/번호까지 SELECT 하므로 60K 건이면 무겁다.
 * 본 함수는 status 별 4개 head 쿼리로 합 ~200ms 안에 끝난다.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { MessageStatus } from "@/types/database";
import {
  isDevSeedMode,
  listDevCampaignMessages,
} from "@/lib/profile/students-dev-seed";

export interface CampaignMessageCounts {
  대기: number;
  발송됨: number;
  도달: number;
  실패: number;
  total: number;
}

export async function getCampaignMessageCounts(
  campaignId: string,
): Promise<CampaignMessageCounts> {
  if (!campaignId) {
    return { 대기: 0, 발송됨: 0, 도달: 0, 실패: 0, total: 0 };
  }

  if (isDevSeedMode()) {
    const rows = listDevCampaignMessages(campaignId);
    const counts: CampaignMessageCounts = {
      대기: 0,
      발송됨: 0,
      도달: 0,
      실패: 0,
      total: rows.length,
    };
    for (const r of rows) counts[r.status] += 1;
    return counts;
  }

  const supabase = await createSupabaseServerClient();
  const statuses: MessageStatus[] = ["대기", "발송됨", "도달", "실패"];

  const results = await Promise.all(
    statuses.map(async (s) => {
      const { count, error } = await supabase
        .from("crm_messages")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .eq("status", s);
      if (error) {
        throw new Error(
          `캠페인 메시지 카운트 실패(${s}): ${error.message}`,
        );
      }
      return [s, count ?? 0] as const;
    }),
  );

  const out: CampaignMessageCounts = {
    대기: 0,
    발송됨: 0,
    도달: 0,
    실패: 0,
    total: 0,
  };
  for (const [s, c] of results) {
    out[s] = c;
    out.total += c;
  }
  return out;
}
