/**
 * F3-A · 단일 템플릿 조회
 *
 * - dev-seed: DEV_TEMPLATES 에서 id 매칭
 * - Supabase: templates.select().eq('id', id).maybeSingle()
 *
 * 반환 타입은 TemplateListItem (= TemplateRow + creator_name).
 * 편집 헤더의 "작성자: <name>" 노출용으로 crm_users_profile 별도 lookup.
 *
 * NOTE (frontend-dev): backend 가 덮어쓸 수 있음. 시그니처 유지.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { TemplateListItem, TemplateRow } from "@/types/database";
import {
  findDevTemplateById,
  isDevSeedMode,
} from "@/lib/profile/students-dev-seed";

export async function getTemplate(
  id: string,
): Promise<TemplateListItem | null> {
  if (!id) return null;

  if (isDevSeedMode()) {
    const row = findDevTemplateById(id);
    if (!row) return null;
    // dev-seed 는 사용자 매핑이 없으므로 creator_name = null.
    return { ...row, creator_name: null };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("crm_templates")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`템플릿 조회에 실패했습니다: ${error.message}`);
  }
  if (!data) return null;

  const row = data as TemplateRow;

  // 작성자 이름 lookup.
  let creatorName: string | null = null;
  if (row.created_by) {
    const { data: profile, error: profileError } = await supabase
      .from("crm_users_profile")
      .select("name")
      .eq("user_id", row.created_by)
      .maybeSingle();
    if (profileError) {
      console.warn(
        `[get-template] 작성자 이름 조회 실패: ${profileError.message}`,
      );
    } else if (profile) {
      creatorName = (profile as { name: string }).name;
    }
  }

  return { ...row, creator_name: creatorName };
}
