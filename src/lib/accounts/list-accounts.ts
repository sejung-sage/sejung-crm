/**
 * F4 · 계정 목록 조회 로더
 *
 * - dev-seed → `listDevAccounts(query)` 결과를 페이지네이션해서 반환.
 * - Supabase → users_profile 에서 조건부 조회 + count.
 *
 * 권한 필터(예: admin 은 자기 분원만 조회) 는 페이지 레벨에서 적용해야 함.
 * 이 함수는 인자 그대로 충실히 조회만 한다.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  isDevSeedMode,
  listDevAccounts,
} from "@/lib/profile/students-dev-seed";
import type { AccountListQuery } from "@/lib/schemas/auth";
import type { AccountListItem } from "@/types/database";

export const ACCOUNTS_PAGE_SIZE = 50;

export async function listAccounts(
  query: AccountListQuery,
): Promise<{ items: AccountListItem[]; total: number }> {
  const page = query.page ?? 1;
  const from = (page - 1) * ACCOUNTS_PAGE_SIZE;
  const to = from + ACCOUNTS_PAGE_SIZE - 1;

  // ─── dev-seed ──────────────────────────────────────────
  if (isDevSeedMode()) {
    const all = listDevAccounts({
      q: query.q,
      role: query.role,
      branch: query.branch,
      active: query.active,
    });
    const total = all.length;
    const items = all.slice(from, to + 1);
    return { items, total };
  }

  // ─── 실 DB ─────────────────────────────────────────────
  const supabase = await createSupabaseServerClient();

  // count 와 body 분리 병렬. head:exact 카운트는 인덱스 only-scan 가능.
  const applyFilters = <
    Q extends {
      eq(col: string, val: string | boolean): Q;
      or(filter: string): Q;
    },
  >(
    qb: Q,
  ): Q => {
    let q = qb;
    if (query.role) q = q.eq("role", query.role);
    if (query.branch && query.branch.length > 0) {
      q = q.eq("branch", query.branch);
    }
    if (query.active === "true") q = q.eq("active", true);
    else if (query.active === "false") q = q.eq("active", false);
    if (query.q && query.q.length > 0) {
      const term = `%${query.q}%`;
      q = q.or(`name.ilike.${term},email.ilike.${term}`);
    }
    return q;
  };

  const countQuery = applyFilters(
    supabase
      .from("crm_users_profile")
      .select("user_id", { count: "exact", head: true }),
  );
  const dataQuery = applyFilters(
    supabase.from("crm_users_profile").select("*"),
  )
    .order("created_at", { ascending: false })
    .range(from, to);

  const [countResult, dataResult] = await Promise.all([countQuery, dataQuery]);

  if (dataResult.error) {
    throw new Error(`계정 목록 조회 실패: ${dataResult.error.message}`);
  }

  const items = (dataResult.data ?? []) as AccountListItem[];
  return {
    items,
    total: countResult.error ? items.length : (countResult.count ?? items.length),
  };
}
