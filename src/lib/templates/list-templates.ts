/**
 * F3-A · 템플릿 목록 조회
 *
 * - dev-seed: DEV_TEMPLATES 에서 필터 적용 후 페이지네이션(50/페이지)
 * - Supabase: templates 테이블 select + count 병행, updated_at DESC
 *
 * 검색어 q: 템플릿명/본문 부분일치(ilike). 빈 값은 필터 미적용.
 *
 * 0059 마이그에서 teacher_name 컬럼 제거 — 강사명 필터/집계 미사용.
 * 시그니처(`listTemplates`, `ListTemplatesResult`) 유지.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { TemplateListItem, TemplateRow } from "@/types/database";
import type { TemplateListQuery } from "@/lib/schemas/template";
import {
  isDevSeedMode,
  listDevTemplates,
} from "@/lib/profile/students-dev-seed";

const PAGE_SIZE = 50;

export interface ListTemplatesResult {
  items: TemplateListItem[];
  total: number;
}

export async function listTemplates(
  query: TemplateListQuery,
): Promise<ListTemplatesResult> {
  if (isDevSeedMode()) {
    return listFromDevSeed(query);
  }
  return listFromSupabase(query);
}

function listFromDevSeed(query: TemplateListQuery): ListTemplatesResult {
  const all = listDevTemplates({
    q: query.q,
    type: query.type,
    branch: query.branch,
  });
  // updated_at DESC
  const sorted = [...all].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at),
  );

  const total = sorted.length;
  const from = (query.page - 1) * PAGE_SIZE;
  // dev-seed 는 사용자 매핑이 없으므로 creator_name = null.
  const items: TemplateListItem[] = sorted
    .slice(from, from + PAGE_SIZE)
    .map((t) => ({ ...t, creator_name: null }));
  return { items, total };
}

async function listFromSupabase(
  query: TemplateListQuery,
): Promise<ListTemplatesResult> {
  const supabase = await createSupabaseServerClient();
  const from = (query.page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // count 와 body 분리 병렬. select(*, count:exact) 는 body+count 가 같은 쿼리에
  // 묶여 풀 스캔 비용 증가. head:exact 만 별도 호출하면 인덱스 only-scan.
  // PostgREST 는 from() 직후엔 filter 가 없고 select() 이후 chain 만 가능.
  const applyFilters = <
    Q extends {
      eq(col: string, val: string): Q;
      or(filter: string): Q;
    },
  >(
    q: Q,
  ): Q => {
    let next = q;
    if (query.type) next = next.eq("type", query.type);
    if (query.branch) next = next.eq("branch", query.branch);
    if (query.q) {
      next = next.or(`name.ilike.%${query.q}%,body.ilike.%${query.q}%`);
    }
    return next;
  };

  const countQuery = applyFilters(
    supabase
      .from("crm_templates")
      .select("id", { count: "exact", head: true }),
  );
  const dataQuery = applyFilters(supabase.from("crm_templates").select("*"))
    .order("updated_at", { ascending: false })
    .range(from, to);

  const [countResult, dataResult] = await Promise.all([countQuery, dataQuery]);

  if (dataResult.error) {
    throw new Error(
      `템플릿 목록 조회에 실패했습니다: ${dataResult.error.message}`,
    );
  }

  // 작성자 이름 매핑. auth.users 외부 schema 라 PostgREST nested select 불가 →
  // crm_users_profile.user_id 로 별도 lookup. RLS 차단/삭제 사용자 시 null →
  // UI 가 "—" 표시.
  const rows = (dataResult.data ?? []) as TemplateRow[];
  const creatorIds = Array.from(
    new Set(
      rows
        .map((r) => r.created_by)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  );
  const nameMap = new Map<string, string>();
  if (creatorIds.length > 0) {
    const { data: profiles, error: profileError } = await supabase
      .from("crm_users_profile")
      .select("user_id, name")
      .in("user_id", creatorIds);
    if (profileError) {
      console.warn(
        `[list-templates] 작성자 이름 조회 실패: ${profileError.message}`,
      );
    } else {
      for (const p of (profiles ?? []) as Array<{
        user_id: string;
        name: string;
      }>) {
        nameMap.set(p.user_id, p.name);
      }
    }
  }

  const items: TemplateListItem[] = rows.map((r) => ({
    ...r,
    creator_name: r.created_by ? (nameMap.get(r.created_by) ?? null) : null,
  }));

  return {
    items,
    total: countResult.error ? 0 : (countResult.count ?? 0),
  };
}
