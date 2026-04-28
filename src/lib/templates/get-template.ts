/**
 * F3-A · 단일 템플릿 조회
 *
 * - dev-seed: DEV_TEMPLATES 에서 id 매칭
 * - Supabase: templates.select().eq('id', id).maybeSingle()
 *
 * NOTE (frontend-dev): backend 가 덮어쓸 수 있음. 시그니처 유지.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { TemplateRow } from "@/types/database";
import {
  findDevTemplateById,
  isDevSeedMode,
} from "@/lib/profile/students-dev-seed";

export async function getTemplate(id: string): Promise<TemplateRow | null> {
  if (!id) return null;

  if (isDevSeedMode()) {
    return findDevTemplateById(id);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("templates")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`템플릿 조회에 실패했습니다: ${error.message}`);
  }
  return (data as TemplateRow | null) ?? null;
}
