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

  // count 와 body 를 분리해 병렬 실행. 한 호출(select * with count:exact) 은
  // body 행과 PG count(*) 가 같은 쿼리 안에서 실행되어 PostgREST max_rows cap·
  // statement timeout 위험이 큰 데이터에서 증가. head:exact 카운트만 별도 호출하면
  // PG planner 가 인덱스 only-scan 으로 처리 가능.
  // PostgREST 는 from() 직후엔 filter 가 없고 select() 이후 chain 만 가능하므로
  // select 직후 filter 적용하는 헬퍼로 통일.
  const applyFilters = <
    Q extends {
      eq(col: string, val: string): Q;
      ilike(col: string, val: string): Q;
    },
  >(
    q: Q,
  ): Q => {
    let next = q;
    if (query.branch) next = next.eq("branch", query.branch);
    if (query.q) next = next.ilike("name", `%${query.q}%`);
    return next;
  };

  const countQuery = applyFilters(
    supabase
      .from("crm_groups")
      .select("id", { count: "exact", head: true }),
  );
  const dataQuery = applyFilters(supabase.from("crm_groups").select("*"))
    .order("last_sent_at", { ascending: false, nullsFirst: false })
    .range(from, to);

  const [countResult, dataResult] = await Promise.all([countQuery, dataQuery]);

  if (dataResult.error) {
    throw new Error(
      `발송 그룹 목록 조회에 실패했습니다: ${dataResult.error.message}`,
    );
  }

  return {
    items: (dataResult.data ?? []) as GroupListItem[],
    total: countResult.error ? 0 : (countResult.count ?? 0),
  };
}
