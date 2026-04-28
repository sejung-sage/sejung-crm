import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { StudentProfileRow } from "@/types/database";
import type { ListStudentsInput } from "@/lib/schemas/student";
import { DEV_STUDENT_PROFILES, isDevSeedMode } from "./students-dev-seed";

export interface ListStudentsResult {
  rows: StudentProfileRow[];
  total: number;
  page: number;
  pageSize: number;
  source: "supabase" | "dev-seed";
}

/**
 * 학생 프로필 목록 조회.
 * - Supabase 연결이 설정되어 있으면 student_profiles 뷰에서 조회
 * - 미설정이면 개발용 인메모리 시드에서 조회 (프로덕션 빌드에선 env 제대로 있어야 함)
 */
export async function listStudents(
  input: ListStudentsInput,
): Promise<ListStudentsResult> {
  if (isDevSeedMode()) {
    return listFromDevSeed(input);
  }
  return listFromSupabase(input);
}

async function listFromSupabase(
  input: ListStudentsInput,
): Promise<ListStudentsResult> {
  const supabase = await createSupabaseServerClient();

  const from = (input.page - 1) * input.pageSize;
  const to = from + input.pageSize - 1;

  let query = supabase
    .from("student_profiles")
    .select("*", { count: "exact" })
    .order("registered_at", { ascending: false, nullsFirst: false });

  if (input.search) {
    // 이름·학교·학부모 연락처 전체 검색
    const like = `%${input.search}%`;
    query = query.or(
      `name.ilike.${like},school.ilike.${like},parent_phone.ilike.${like}`,
    );
  }

  if (input.branch && input.branch !== "전체") {
    query = query.eq("branch", input.branch);
  }

  if (input.grades.length > 0) {
    query = query.in("grade", input.grades);
  }

  if (input.tracks.length > 0) {
    query = query.in("track", input.tracks);
  }

  if (input.statuses.length > 0) {
    query = query.in("status", input.statuses);
  }

  const { data, count, error } = await query.range(from, to);

  if (error) {
    throw new Error(`학생 목록 조회에 실패했습니다: ${error.message}`);
  }

  return {
    rows: (data ?? []) as StudentProfileRow[],
    total: count ?? 0,
    page: input.page,
    pageSize: input.pageSize,
    source: "supabase",
  };
}

function listFromDevSeed(input: ListStudentsInput): ListStudentsResult {
  let rows = [...DEV_STUDENT_PROFILES];

  if (input.search) {
    const q = input.search.toLowerCase();
    rows = rows.filter((r) => {
      const name = r.name?.toLowerCase() ?? "";
      const school = r.school?.toLowerCase() ?? "";
      const phone = r.parent_phone ?? "";
      return (
        name.includes(q) ||
        school.includes(q) ||
        phone.includes(input.search)
      );
    });
  }

  if (input.branch && input.branch !== "전체") {
    rows = rows.filter((r) => r.branch === input.branch);
  }

  if (input.grades.length > 0) {
    rows = rows.filter((r) => r.grade !== null && input.grades.includes(r.grade));
  }

  if (input.tracks.length > 0) {
    rows = rows.filter(
      (r) => r.track !== null && input.tracks.includes(r.track),
    );
  }

  if (input.statuses.length > 0) {
    rows = rows.filter((r) => input.statuses.includes(r.status));
  }

  // 등록일 역순 정렬 (null은 뒤로)
  rows.sort((a, b) => {
    if (!a.registered_at && !b.registered_at) return 0;
    if (!a.registered_at) return 1;
    if (!b.registered_at) return -1;
    return b.registered_at.localeCompare(a.registered_at);
  });

  const total = rows.length;
  const from = (input.page - 1) * input.pageSize;
  const paged = rows.slice(from, from + input.pageSize);

  return {
    rows: paged,
    total,
    page: input.page,
    pageSize: input.pageSize,
    source: "dev-seed",
  };
}
