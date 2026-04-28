/**
 * F3-A · 템플릿 목록 조회
 *
 * - dev-seed: DEV_TEMPLATES 에서 필터 적용 후 페이지네이션(50/페이지)
 * - Supabase: templates 테이블 select + count 병행, updated_at DESC
 *
 * 검색어 q: 템플릿명/본문 부분일치(ilike). 빈 값은 필터 미적용.
 *
 * NOTE (frontend-dev): backend 가 Supabase 분기를 덮어쓸 수 있음. 시그니처
 * (`listTemplates`, `ListTemplatesResult`, `listUniqueTeachers`) 유지 필요.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { TemplateRow } from "@/types/database";
import type { TemplateListQuery } from "@/lib/schemas/template";
import {
  DEV_TEMPLATES,
  isDevSeedMode,
  listDevTemplates,
} from "@/lib/profile/students-dev-seed";

const PAGE_SIZE = 50;

export interface ListTemplatesResult {
  items: TemplateRow[];
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
    teacher_name: query.teacher_name,
  });
  // updated_at DESC
  const sorted = [...all].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at),
  );

  const total = sorted.length;
  const from = (query.page - 1) * PAGE_SIZE;
  const items = sorted.slice(from, from + PAGE_SIZE);
  return { items, total };
}

async function listFromSupabase(
  query: TemplateListQuery,
): Promise<ListTemplatesResult> {
  const supabase = await createSupabaseServerClient();
  const from = (query.page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let q = supabase
    .from("templates")
    .select("*", { count: "exact" })
    .order("updated_at", { ascending: false });

  if (query.type) {
    q = q.eq("type", query.type);
  }
  if (query.teacher_name) {
    q = q.eq("teacher_name", query.teacher_name);
  }
  if (query.q) {
    q = q.or(`name.ilike.%${query.q}%,body.ilike.%${query.q}%`);
  }

  const { data, count, error } = await q.range(from, to);
  if (error) {
    throw new Error(`템플릿 목록 조회에 실패했습니다: ${error.message}`);
  }

  return {
    items: (data ?? []) as TemplateRow[],
    total: count ?? 0,
  };
}

/**
 * 툴바 필터용 — 사용 가능한 강사명 후보(정렬된 유니크 리스트).
 * dev-seed 에선 DEV_TEMPLATES 에서 추출.
 */
export async function listUniqueTeachers(): Promise<string[]> {
  if (isDevSeedMode()) {
    const set = new Set<string>();
    for (const t of DEV_TEMPLATES) {
      if (t.teacher_name && t.teacher_name.trim().length > 0) {
        set.add(t.teacher_name);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("templates")
    .select("teacher_name")
    .not("teacher_name", "is", null);
  if (error) {
    return [];
  }
  const set = new Set<string>();
  for (const row of (data ?? []) as { teacher_name: string | null }[]) {
    if (row.teacher_name) set.add(row.teacher_name);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
}
