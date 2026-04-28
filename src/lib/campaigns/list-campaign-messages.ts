/**
 * F3-A · 캠페인 건별 메시지 리스트
 *
 * - dev-seed: listDevCampaignMessages (학생명 조인 포함)
 * - Supabase: messages + students 조인
 *
 * NOTE (frontend-dev): backend 가 덮어쓸 수 있음.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CampaignMessageRow } from "@/types/database";
import {
  isDevSeedMode,
  listDevCampaignMessages,
} from "@/lib/profile/students-dev-seed";

export async function listCampaignMessages(
  campaignId: string,
): Promise<CampaignMessageRow[]> {
  if (!campaignId) return [];

  if (isDevSeedMode()) {
    return listDevCampaignMessages(campaignId);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`캠페인 메시지 조회에 실패했습니다: ${error.message}`);
  }
  return (data ?? []) as CampaignMessageRow[];
}
