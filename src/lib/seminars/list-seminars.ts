/**
 * 설명회 리스트 조회 (운영자) · 0080
 *
 * - dev-seed: `listMockSeminars(branch)` 결과를 SeminarListItem 으로 어댑팅
 *   (mock 의 필드명이 다르므로 매핑 필수: starts_at → held_at,
 *   application_deadline → signup_closes_at, token → link_token 등).
 *
 * - 실 DB : crm_seminars + status='signed' 카운트.
 *   count 는 한 번에 묶을 수 없으므로 본문 fetch 후 in-memory join.
 *   세미나 페이지는 분원당 N십 건 규모로 가정 — 페이지네이션은 검색어 단계에서만.
 *
 * 권한 가드:
 *  - 호출부(page) 가 master/admin 여부 확인.
 *  - 데이터 자체의 분원 격리는 RLS 가 2차 방어. (master 가 사이드바에서 "전체" 선택 시
 *    branch === undefined 로 호출하면 전체 분원 반환)
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  isDevSeedMode,
} from "@/lib/profile/students-dev-seed";
import {
  listMockSeminars,
  type MockSeminar,
} from "@/lib/seminars/dev-seed";
import type { Branch } from "@/config/branches";
import type {
  SeminarListItem,
  SeminarRow,
  SeminarStatus,
} from "@/types/database";
import type { SeminarListQuery } from "@/lib/schemas/seminar";

export interface ListSeminarsResult {
  items: SeminarListItem[];
  total: number;
}

/**
 * 운영자 설명회 리스트.
 *
 * @param query  branch/status/q (page 는 일단 무시 — Phase 1 은 전체 노출).
 */
export async function listSeminars(
  query: SeminarListQuery,
): Promise<ListSeminarsResult> {
  if (isDevSeedMode()) {
    return listFromDevSeed(query);
  }
  return listFromSupabase(query);
}

// ─── dev-seed 어댑터 ───────────────────────────────────────────

function listFromDevSeed(query: SeminarListQuery): ListSeminarsResult {
  const branchArg =
    query.branch && query.branch.trim().length > 0
      ? (query.branch as Branch)
      : undefined;
  const rows = listMockSeminars(branchArg);

  const filtered = rows.filter((r) => {
    if (query.status && r.status !== query.status) return false;
    if (query.q && !r.name.toLowerCase().includes(query.q.toLowerCase())) {
      return false;
    }
    return true;
  });

  // signup_count 는 mock 이 이미 산출 → 그대로 사용.
  const items: SeminarListItem[] = filtered.map((r) =>
    mockToSeminarListItem(r, r.signup_count),
  );

  return { items, total: items.length };
}

/**
 * MockSeminar 의 필드를 SeminarListItem(0082 컬럼명)으로 어댑팅.
 * - starts_at → held_at
 * - application_deadline → signup_closes_at
 * - 0082 에서 crm_seminars.link_token 폐기 → SeminarRow 에서 사라짐.
 *   학생 페이지 토큰은 invitation 단위로 이동했으므로 본 어댑터에서 노출 안 함.
 * - signup_opens_at, created_by, updated_at 는 mock 에 없어 합리적 default.
 */
function mockToSeminarListItem(
  m: MockSeminar,
  signupCount: number,
): SeminarListItem {
  return {
    id: m.id,
    branch: m.branch,
    name: m.name,
    description: m.description,
    held_at: m.starts_at,
    venue: m.venue,
    capacity: m.capacity,
    signup_opens_at: null,
    signup_closes_at: m.application_deadline,
    status: m.status,
    created_by: null,
    created_at: m.created_at,
    updated_at: m.created_at,
    signup_count: signupCount,
  };
}

// ─── Supabase 어댑터 ──────────────────────────────────────────

async function listFromSupabase(
  query: SeminarListQuery,
): Promise<ListSeminarsResult> {
  const supabase = await createSupabaseServerClient();

  // 분원/상태/검색 필터.
  type SeminarsQuery = {
    eq(col: string, val: string): SeminarsQuery;
    ilike(col: string, val: string): SeminarsQuery;
    order(
      col: string,
      opts: { ascending: boolean; nullsFirst?: boolean },
    ): SeminarsQuery;
  };
  const applyFilters = (q: SeminarsQuery): SeminarsQuery => {
    let next = q;
    if (query.branch) next = next.eq("branch", query.branch);
    if (query.status) next = next.eq("status", query.status);
    if (query.q) next = next.ilike("name", `%${query.q}%`);
    return next;
  };

  const baseQuery = supabase.from("crm_seminars").select("*");
  const orderedQuery = applyFilters(baseQuery as unknown as SeminarsQuery).order(
    "created_at",
    { ascending: false },
  );

  const { data, error } = (await orderedQuery) as unknown as {
    data: SeminarRow[] | null;
    error: { message: string } | null;
  };
  if (error) {
    throw new Error(`설명회 목록 조회에 실패했습니다: ${error.message}`);
  }
  const rows: SeminarRow[] = data ?? [];

  if (rows.length === 0) {
    return { items: [], total: 0 };
  }

  // 각 설명회별 신청수(=invitation_items.status='signed') 집계.
  // PostgREST 는 group by 가 제한적이라 단일 SELECT 후 in-memory 카운트.
  // (옛 crm_seminar_signups 는 0082 이후 신규 INSERT 없어 신뢰 불가.)
  const seminarIds = rows.map((r) => r.id);
  const { data: signupRows, error: signupError } = (await supabase
    .from("crm_seminar_invitation_items")
    .select("seminar_id")
    .eq("status", "signed")
    .in("seminar_id", seminarIds)) as unknown as {
    data: Array<{ seminar_id: string }> | null;
    error: { message: string } | null;
  };

  const counts = new Map<string, number>();
  if (signupError) {
    console.warn(`[list-seminars] 신청수 집계 실패: ${signupError.message}`);
  } else {
    for (const s of signupRows ?? []) {
      counts.set(s.seminar_id, (counts.get(s.seminar_id) ?? 0) + 1);
    }
  }

  const items: SeminarListItem[] = rows.map((r) => ({
    ...r,
    status: r.status as SeminarStatus,
    signup_count: counts.get(r.id) ?? 0,
  }));

  return { items, total: items.length };
}
