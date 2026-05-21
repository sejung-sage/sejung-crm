/**
 * 캠페인 발송자(작성자) 옵션 list — 발송자 필터 dropdown 용.
 *
 * 정책:
 *  - 지금까지 1건이라도 캠페인을 발송한 사용자만 옵션으로. (활성 계정 전체 X)
 *  - distinct created_by → crm_users_profile.name 매핑.
 *  - dev-seed: 빈 배열.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";

export interface CampaignSenderOption {
  userId: string;
  name: string;
}

export async function listCampaignSenders(): Promise<CampaignSenderOption[]> {
  if (isDevSeedMode()) return [];

  const supabase = await createSupabaseServerClient();

  // 1) crm_campaigns 의 distinct created_by 페치
  //    PostgREST 는 SELECT DISTINCT 미지원 → 페이지네이션 + Set dedup.
  //    캠페인 수가 폭증해도 unique 발송자는 수십명 단위라 안전.
  const PAGE_SIZE = 1000;
  const MAX_PAGES = 20;
  const userIds = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("crm_campaigns")
      .select("created_by")
      .not("created_by", "is", null)
      .range(from, to);
    if (error) return [];
    const rows = (data ?? []) as Array<{ created_by: string | null }>;
    if (rows.length === 0) break;
    for (const r of rows) if (r.created_by) userIds.add(r.created_by);
    if (rows.length < PAGE_SIZE) break;
  }

  if (userIds.size === 0) return [];

  // 2) name lookup
  const { data: profiles } = await supabase
    .from("crm_users_profile")
    .select("user_id, name")
    .in("user_id", Array.from(userIds));

  const nameMap = new Map<string, string>();
  for (const p of (profiles ?? []) as Array<{ user_id: string; name: string }>) {
    nameMap.set(p.user_id, p.name);
  }

  // RLS 로 lookup 실패한 사용자도 옵션에 포함 (이름은 'UUID 8자리' fallback).
  const options: CampaignSenderOption[] = Array.from(userIds).map((uid) => ({
    userId: uid,
    name: nameMap.get(uid) ?? `사용자 ${uid.slice(0, 8)}`,
  }));

  options.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return options;
}
