/**
 * F2 · 발송 그룹 목록 조회
 *
 * - dev-seed: DEV_GROUPS 에서 분원/검색 적용 후 페이지네이션(50/페이지)
 * - Supabase: groups 테이블 select + count 병행, last_sent_at DESC NULLS LAST
 *
 * 검색어 q 는 그룹명 부분일치(ilike). 빈 branch / q 는 필터 미적용.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { GroupListItem } from "@/types/database";
import type { GroupListQuery } from "@/lib/schemas/group";
import { isDevSeedMode, listDevGroups } from "@/lib/profile/students-dev-seed";

const PAGE_SIZE = 50;

export interface ListGroupsResult {
  items: GroupListItem[];
  total: number;
}

export async function listGroups(
  query: GroupListQuery,
): Promise<ListGroupsResult> {
  if (isDevSeedMode()) {
    return listFromDevSeed(query);
  }
  return listFromSupabase(query);
}

function listFromDevSeed(query: GroupListQuery): ListGroupsResult {
  const all = listDevGroups({ branch: query.branch, q: query.q });
  // last_sent_at DESC NULLS LAST
  const sorted = [...all].sort((a, b) => {
    if (a.last_sent_at === b.last_sent_at) return 0;
    if (a.last_sent_at === null) return 1;
    if (b.last_sent_at === null) return -1;
    return b.last_sent_at.localeCompare(a.last_sent_at);
  });

  const total = sorted.length;
  const from = (query.page - 1) * PAGE_SIZE;
  const items = sorted.slice(from, from + PAGE_SIZE);
  return { items, total };
}

async function listFromSupabase(
  query: GroupListQuery,
): Promise<ListGroupsResult> {
  const supabase = await createSupabaseServerClient();
  const from = (query.page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let q = supabase
    .from("groups")
    .select("*", { count: "exact" })
    .order("last_sent_at", { ascending: false, nullsFirst: false });

  if (query.branch) {
    q = q.eq("branch", query.branch);
  }
  if (query.q) {
    q = q.ilike("name", `%${query.q}%`);
  }

  const { data, count, error } = await q.range(from, to);
  if (error) {
    throw new Error(`발송 그룹 목록 조회에 실패했습니다: ${error.message}`);
  }

  return {
    items: (data ?? []) as GroupListItem[],
    total: count ?? 0,
  };
}
