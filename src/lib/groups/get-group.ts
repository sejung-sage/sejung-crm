/**
 * F2 · 발송 그룹 단건 조회
 *
 * - dev-seed: `findDevGroupById`
 * - Supabase: `from('groups').select('*').eq('id', id).maybeSingle()`
 * - 없으면 `null` 을 반환. 호출부에서 404 처리.
 *
 * 반환 타입은 GroupListItem (= GroupRow + creator_name).
 * `created_by` 는 auth.users(id) FK 라 PostgREST nested select 가 불가하므로
 * crm_users_profile 을 별도 lookup 하여 creator_name 에 채운다. 매핑 실패 시 null.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { GroupListItem, GroupRow } from "@/types/database";
import { GroupFiltersSchema } from "@/lib/schemas/group";
import { findDevGroupById, isDevSeedMode } from "@/lib/profile/students-dev-seed";

/**
 * 발송 그룹 단건 조회.
 *
 * 반환된 GroupRow 의 `filters` 는 항상 GroupFiltersSchema 가 보장하는 정규
 * 형태(모든 array 필드가 빈 배열 default 적용 후) 로 정렬된다 — 신규 추가된
 * 필드(예: regions) 가 옛 그룹의 JSONB 에 없어도 호출부가 안전하게
 * `filters.X.length` 류 코드를 쓸 수 있다. 정규화 실패(스키마 위반) 시
 * 빈 필터로 폴백해 노이즈를 최소화한다 — 옛 데이터 한 건 때문에 페이지가
 * 깨지는 것보다 "조건 없음(전체)" 보기가 안전.
 */
export async function getGroup(id: string): Promise<GroupListItem | null> {
  if (isDevSeedMode()) {
    const row = findDevGroupById(id);
    if (!row) return null;
    // dev-seed 는 사용자 매핑이 없으므로 creator_name = null.
    return { ...withNormalizedFilters(row), creator_name: null };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("crm_groups")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`발송 그룹 조회에 실패했습니다: ${error.message}`);
  }
  if (!data) return null;

  const normalized = withNormalizedFilters(data as GroupRow);

  // 작성자 이름 lookup (list-groups 와 동일 패턴).
  let creatorName: string | null = null;
  if (normalized.created_by) {
    const { data: profile, error: profileError } = await supabase
      .from("crm_users_profile")
      .select("name")
      .eq("user_id", normalized.created_by)
      .maybeSingle();
    if (profileError) {
      console.warn(
        `[get-group] 작성자 이름 조회 실패: ${profileError.message}`,
      );
    } else if (profile) {
      creatorName = (profile as { name: string }).name;
    }
  }

  return { ...normalized, creator_name: creatorName };
}

function withNormalizedFilters(row: GroupRow): GroupRow {
  const parsed = GroupFiltersSchema.safeParse(row.filters);
  if (parsed.success) {
    return { ...row, filters: parsed.data };
  }
  return {
    ...row,
    filters: {
      grades: [],
      schools: [],
      subjects: [],
      regions: [],
      statuses: [],
      includeStudentIds: [],
      excludeStudentIds: [],
    },
  };
}
