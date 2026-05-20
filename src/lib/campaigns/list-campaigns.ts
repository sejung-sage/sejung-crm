/**
 * F3-A · 캠페인 목록 조회
 *
 * - dev-seed: listDevCampaigns (템플릿/그룹 조인 + 도달·실패 집계 내장)
 * - Supabase: campaigns + templates + groups left join + messages 집계
 *
 * NOTE (frontend-dev): backend 가 Supabase 분기를 덮어쓸 수 있음. 시그니처
 * (`listCampaigns`, `ListCampaignsResult`) 유지.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CampaignListItem } from "@/types/database";
import type { CampaignListQuery } from "@/lib/schemas/campaign";
import {
  isDevSeedMode,
  listDevCampaigns,
} from "@/lib/profile/students-dev-seed";

const PAGE_SIZE = 50;

export interface ListCampaignsResult {
  items: CampaignListItem[];
  total: number;
}

export async function listCampaigns(
  query: CampaignListQuery,
): Promise<ListCampaignsResult> {
  if (isDevSeedMode()) {
    return listFromDevSeed(query);
  }
  return listFromSupabase(query);
}

function listFromDevSeed(query: CampaignListQuery): ListCampaignsResult {
  const all = listDevCampaigns({
    q: query.q,
    status: query.status,
    from: query.from,
    to: query.to,
  });
  // sent_at/scheduled_at/created_at DESC NULLS LAST
  const sorted = [...all].sort((a, b) => {
    const aKey = a.sent_at ?? a.scheduled_at ?? a.created_at;
    const bKey = b.sent_at ?? b.scheduled_at ?? b.created_at;
    return bKey.localeCompare(aKey);
  });

  const total = sorted.length;
  const from = (query.page - 1) * PAGE_SIZE;
  const items = sorted.slice(from, from + PAGE_SIZE);
  return { items, total };
}

async function listFromSupabase(
  query: CampaignListQuery,
): Promise<ListCampaignsResult> {
  const supabase = await createSupabaseServerClient();
  const from = (query.page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // count 와 body 분리 병렬. select(*, count:exact) 는 body+count 가 같은 쿼리에
  // 묶여 풀 스캔 비용 증가. head:exact 만 별도 호출하면 인덱스 only-scan.
  // PostgREST 는 from() 직후엔 filter 가 없고 select() 이후 chain 만 가능.
  const applyFilters = <
    Q extends {
      eq(col: string, val: string): Q;
      ilike(col: string, val: string): Q;
      gte(col: string, val: string): Q;
      lte(col: string, val: string): Q;
    },
  >(
    q: Q,
  ): Q => {
    let next = q;
    if (query.status) next = next.eq("status", query.status);
    if (query.q) next = next.ilike("title", `%${query.q}%`);
    if (query.from) next = next.gte("sent_at", `${query.from}T00:00:00+09:00`);
    if (query.to) next = next.lte("sent_at", `${query.to}T23:59:59+09:00`);
    return next;
  };

  const countQuery = applyFilters(
    supabase
      .from("crm_campaigns")
      .select("id", { count: "exact", head: true }),
  );
  const dataQuery = applyFilters(supabase.from("crm_campaigns").select("*"))
    .order("created_at", { ascending: false })
    .range(from, to);

  const [countResult, dataResult] = await Promise.all([countQuery, dataQuery]);

  if (dataResult.error) {
    throw new Error(
      `캠페인 목록 조회에 실패했습니다: ${dataResult.error.message}`,
    );
  }

  // 조인·집계는 backend 가 완성 시 덮어씀. 우선 최소 형태로 변환.
  const items: CampaignListItem[] = ((dataResult.data ?? []) as unknown[]).map((r) => {
    const row = r as Record<string, unknown>;
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
      body: (row.body ?? null) as string | null,
      subject: (row.subject ?? null) as string | null,
      type: (row.type ?? null) as CampaignListItem["type"],
      is_ad: (row.is_ad ?? false) as boolean,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      template_name: null,
      group_name: null,
      delivered_count: 0,
      failed_count: 0,
    };
  });

  return {
    items,
    total: countResult.error ? 0 : (countResult.count ?? 0),
  };
}
