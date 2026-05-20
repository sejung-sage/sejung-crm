/**
 * F2 · 발송 그룹 상세 · 수신자 전체 목록 (페이지네이션)
 *
 * 그룹 id 로 필터를 꺼내 동일한 자동 제외 규칙을 적용한 수신자 목록을 반환.
 * - dev-seed: `applyGroupFiltersDev` 재사용
 * - Supabase: `count-recipients.ts` 와 같은 분기 정책 (includeStudentIds 우선)
 *
 * 주의:
 *   - 수신거부 phone 제외는 SQL 단(.or)에서 처리. 1000-cap 우회 위해
 *     count(head=true) + range 페이지 패턴.
 *   - includeStudentIds 가 있으면 grades/schools/subjects 조건은 무시.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { StudentProfileRow } from "@/types/database";
import {
  DEV_STUDENT_PROFILES,
  isDevSeedMode,
} from "@/lib/profile/students-dev-seed";
import { applyGroupFiltersDev } from "./apply-filters";
import { getGroup } from "./get-group";
import { getUnsubscribedPhones } from "@/lib/messaging/unsubscribed-phones";

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

  // 수신거부 phone — React cache 공유.
  const safeUnsubPhones = await getUnsubscribedPhones();

  // count + page 두 쿼리. count-recipients.ts 와 동일 분기 정책.
  const buildQuery = (
    selectExpr: string,
    options: { count?: "exact"; head?: boolean } = {},
  ) => {
    let q = supabase
      .from("student_profiles")
      .select(selectExpr, options)
      .neq("status", "탈퇴")
      .eq("branch", group.branch);

    // 재원 상태 — count-recipients 와 동일하게 빈 배열이면 default '재원생'.
    const wantedStatuses =
      group.filters.statuses.length > 0
        ? group.filters.statuses
        : ["재원생"];
    q = q.in("status", wantedStatuses);

    // includeStudentIds 가 있으면 조건 무시.
    if (group.filters.includeStudentIds.length > 0) {
      q = q.in("id", group.filters.includeStudentIds);
    } else {
      if (group.filters.grades.length > 0) {
        q = q.in("grade", group.filters.grades);
      }
      if (group.filters.schools.length > 0) {
        q = q.in("school", group.filters.schools);
      }
      if (group.filters.subjects.length > 0) {
        q = q.overlaps("subjects", group.filters.subjects);
      }
      if (group.filters.regions.length > 0) {
        q = q.in("region", group.filters.regions);
      }
    }

    // 그룹 단건 삭제(2026-05-19) — 명시 제외 학생.
    const excludeIds = group.filters.excludeStudentIds ?? [];
    if (excludeIds.length > 0) {
      q = q.not("id", "in", `(${excludeIds.join(",")})`);
    }

    // 수신거부 SQL 단 제외
    if (safeUnsubPhones.length > 0) {
      q = q.or(
        `parent_phone.is.null,parent_phone.not.in.(${safeUnsubPhones.join(",")})`,
      );
    }

    return q;
  };

  // 1) head + count=exact 로 total
  const { count, error: countError } = await buildQuery("id", {
    count: "exact",
    head: true,
  });
  if (countError) {
    throw new Error(
      `그룹 수신자 카운트 조회에 실패했습니다: ${countError.message}`,
    );
  }

  // 2) page slice
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const { data, error } = await buildQuery("*")
    .order("registered_at", { ascending: false, nullsFirst: false })
    .range(from, to);
  if (error) {
    throw new Error(`그룹 수신자 목록 조회에 실패했습니다: ${error.message}`);
  }

  return {
    items: (data ?? []) as StudentProfileRow[],
    total: count ?? 0,
  };
}
