/**
 * F2 · 발송 그룹 단건 조회
 *
 * - dev-seed: `findDevGroupById`
 * - Supabase: `from('groups').select('*').eq('id', id).maybeSingle()`
 * - 없으면 `null` 을 반환. 호출부에서 404 처리.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { GroupRow } from "@/types/database";
import { findDevGroupById, isDevSeedMode } from "@/lib/profile/students-dev-seed";

export async function getGroup(id: string): Promise<GroupRow | null> {
  if (isDevSeedMode()) {
    return findDevGroupById(id);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("groups")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`발송 그룹 조회에 실패했습니다: ${error.message}`);
  }
  return (data as GroupRow | null) ?? null;
}
