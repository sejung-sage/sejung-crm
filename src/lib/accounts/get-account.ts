/**
 * F4 · 계정 단건 조회
 *
 * - dev-seed → `findDevAccountById`.
 * - 실 DB → users_profile 단건.
 *
 * 권한 검사는 호출자가 수행해야 한다(admin 은 본인 분원만 조회 가능 등).
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  findDevAccountById,
  isDevSeedMode,
} from "@/lib/profile/students-dev-seed";
import type { UserProfileRow } from "@/types/database";

export async function getAccount(
  userId: string,
): Promise<UserProfileRow | null> {
  if (!userId) return null;

  if (isDevSeedMode()) {
    return findDevAccountById(userId);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("users_profile")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;
  return data as UserProfileRow;
}
