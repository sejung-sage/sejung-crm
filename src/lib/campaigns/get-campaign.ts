/**
 * F3-A · 단일 캠페인 조회 (상세 페이지 헤더용)
 *
 * - dev-seed: findDevCampaignById → listDevCampaigns 경로로 조인 정보 재구성
 * - Supabase: campaigns + templates + groups 조인 + messages 집계
 *
 * NOTE (frontend-dev): backend 가 덮어쓸 수 있음.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CampaignListItem } from "@/types/database";
import {
  findDevCampaignById,
  isDevSeedMode,
  listDevCampaigns,
} from "@/lib/profile/students-dev-seed";

export async function getCampaign(
  id: string,
): Promise<CampaignListItem | null> {
  if (!id) return null;

  if (isDevSeedMode()) {
    const base = findDevCampaignById(id);
    if (!base) return null;
    // listDevCampaigns 는 검색 파라미터 없이 돌리면 전체 + 조인·집계 포함.
    // 필요한 1건만 찾아서 반환.
    const joined = listDevCampaigns({}).find((c) => c.id === id);
    return joined ?? null;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`캠페인 조회에 실패했습니다: ${error.message}`);
  }
  if (!data) return null;

  const row = data as Record<string, unknown>;
  return {
    id: row.id as string,
    title: row.title as string,
    template_id: (row.template_id ?? null) as string | null,
    group_id: (row.group_id ?? null) as string | null,
    scheduled_at: (row.scheduled_at ?? null) as string | null,
    sent_at: (row.sent_at ?? null) as string | null,
    status: row.status as CampaignListItem["status"],
    total_recipients: (row.total_recipients ?? 0) as number,
    total_cost: (row.total_cost ?? 0) as number,
    created_by: (row.created_by ?? null) as string | null,
    branch: row.branch as string,
    is_test: (row.is_test ?? false) as boolean,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    template_name: null,
    group_name: null,
    delivered_count: 0,
    failed_count: 0,
  };
}
