/**
 * F2 · 발송 그룹 상세 · 수신자 전체 목록 (페이지네이션)
 *
 * 그룹 id 로 필터를 꺼내 동일한 자동 제외 규칙을 적용한 수신자 목록을 반환.
 * - dev-seed: `applyGroupFiltersDev` 재사용
 * - Supabase: `count-recipients.ts` 와 같은 쿼리 → 페이지 슬라이싱
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { StudentProfileRow } from "@/types/database";
import {
  DEV_STUDENT_PROFILES,
  isDevSeedMode,
} from "@/lib/profile/students-dev-seed";
import { applyGroupFiltersDev } from "./apply-filters";
import { getGroup } from "./get-group";

const PAGE_SIZE = 50;

export interface ListGroupStudentsQuery {
  page?: number;
}

export interface ListGroupStudentsResult {
  items: StudentProfileRow[];
  total: number;
}

export async function listGroupStudents(
  groupId: string,
  query: ListGroupStudentsQuery,
): Promise<ListGroupStudentsResult> {
  const group = await getGroup(groupId);
  if (!group) {
    return { items: [], total: 0 };
  }
  const page = Math.max(1, query.page ?? 1);

  if (isDevSeedMode()) {
    const matched = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      group.filters,
      group.branch,
    );
    const from = (page - 1) * PAGE_SIZE;
    return {
      items: matched.slice(from, from + PAGE_SIZE),
      total: matched.length,
    };
  }

  const supabase = await createSupabaseServerClient();

  // 수신거부 phone 선페치
  const { data: unsubRows, error: unsubError } = await supabase
    .from("unsubscribes")
    .select("phone");
  if (unsubError) {
    throw new Error(
      `수신거부 목록 조회에 실패했습니다: ${unsubError.message}`,
    );
  }
  const unsub = new Set<string>(
    (unsubRows ?? [])
      .map((r) => (r as { phone: string }).phone)
      .filter((v): v is string => typeof v === "string" && v.length > 0),
  );

  let q = supabase
    .from("student_profiles")
    .select("*")
    .neq("status", "탈퇴")
    .eq("branch", group.branch);

  if (group.filters.grades.length > 0) {
    q = q.in("grade", group.filters.grades);
  }
  if (group.filters.schools.length > 0) {
    q = q.in("school", group.filters.schools);
  }
  if (group.filters.subjects.length > 0) {
    q = q.overlaps("subjects", group.filters.subjects);
  }

  const { data, error } = await q.order("registered_at", {
    ascending: false,
    nullsFirst: false,
  });
  if (error) {
    throw new Error(`그룹 수신자 목록 조회에 실패했습니다: ${error.message}`);
  }

  const rows = (data ?? []) as StudentProfileRow[];
  const filtered = rows.filter(
    (r) => !(r.parent_phone && unsub.has(r.parent_phone)),
  );

  const from = (page - 1) * PAGE_SIZE;
  return {
    items: filtered.slice(from, from + PAGE_SIZE),
    total: filtered.length,
  };
}
