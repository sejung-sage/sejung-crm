/**
 * F0 · 강좌 리스트 (/classes) 데이터 조회
 *
 * 학생 리스트(`@/lib/profile/list-students`) 의 패턴을 그대로 미러링하되,
 * 강좌별 수강생 수 집계를 위해 enrollments 2차 쿼리를 더한다.
 *
 * 쿼리 구조 (PostgREST `max_rows = 1000` cap 회피 + 페이지네이션):
 *   1) classes 카운트 쿼리 — head + count=exact, 모든 필터 적용. body 없음.
 *   2) classes 페이지 쿼리 — 동일 필터 + range(offset, offset+pageSize-1) + 정렬.
 *   3) 페이지의 aca_class_id 들로 enrollments 한 번 조회 →
 *      JS 에서 Map<aca_class_id, Set<student_id>> 로 distinct count 집계.
 *
 * 정렬 정책 (사용자 확정):
 *   - 1순위 branch ASC
 *   - 2순위 subject ASC NULLS LAST
 *   - 3순위 name ASC
 *
 * 검색 escape 정책:
 *   - PostgREST `.or(...)` 는 콤마/괄호로 토큰을 분리하므로 사용자 입력에서
 *     `,` 와 `()` 를 제거 (sanitizeSearchTerm). count-recipients.ts 의 phone
 *     정규식 화이트리스트와 같은 정책 — "안전한 문자만 통과시키되, 강좌 검색은
 *     한글·영문·숫자·공백 등 폭이 넓으므로 블랙리스트 방식으로 메타문자만 제거".
 *   - `%` 와 `_` 는 ilike 와일드카드로 동작하지만, 사용자가 입력했을 때 의도치
 *     않은 매칭이 일어날 뿐 인젝션 위험은 아니므로 그대로 둔다.
 *
 * dev seed 모드:
 *   - 학생 dev seed 에는 강좌 시드가 없어 의미 있는 출력을 만들 수 없다.
 *   - 빈 배열 + total=0 으로 단순 반환.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ClassFilters } from "@/lib/schemas/class";
import type { ClassListItem, ClassRow } from "@/types/database";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";

export interface ListClassesResult {
  /** 페이지 행 (수강생 수 집계 포함). */
  rows: ClassListItem[];
  /** 필터 적용 후 전체 매칭 행 수 (페이지네이션용). */
  total: number;
  page: number;
  pageSize: number;
}

/** 페이지 사이즈 상한. Zod 스키마(max 200) 와 같은 값으로 한 번 더 가드. */
const MAX_PAGE_SIZE = 200;

/**
 * PostgREST `.or(...)` 인자 인젝션 방어용 sanitizer.
 * - 콤마: OR 절 토큰 구분자 → 제거
 * - 괄호: 그룹/함수 인자 구분자 → 제거
 * 그 외 ilike 메타문자(%, _)는 보존 (와일드카드 매칭 기능).
 */
function sanitizeSearchTerm(s: string): string {
  return s.replace(/[(),]/g, "").trim();
}

export async function listClasses(
  filters: ClassFilters,
): Promise<ListClassesResult> {
  // dev seed 에는 강좌 시드가 없어 의미 있는 출력을 만들 수 없다.
  // UI 가 빈 상태(0건) 를 그대로 그릴 수 있도록 단순 반환한다.
  if (isDevSeedMode()) {
    return {
      rows: [],
      total: 0,
      page: filters.page,
      pageSize: filters.pageSize,
    };
  }

  return listFromSupabase(filters);
}

async function listFromSupabase(
  filters: ClassFilters,
): Promise<ListClassesResult> {
  const supabase = await createSupabaseServerClient();

  // pageSize clamp (DoS 방어). Zod 스키마에 max=200 있으나 안전하게 한 번 더.
  const pageSize = Math.min(Math.max(filters.pageSize, 1), MAX_PAGE_SIZE);
  const page = Math.max(filters.page, 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // (1) 카운트 쿼리 + (2) 페이지 쿼리 — 같은 필터를 양쪽에 동일 적용.
  const countQuery = applyClassFilters(
    supabase
      .from("classes")
      .select("id", { count: "exact", head: true }),
    filters,
  );

  const pageQuery = applyClassFilters(
    supabase.from("classes").select("*"),
    filters,
  )
    .order("branch", { ascending: true })
    .order("subject", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true })
    .range(from, to);

  const [countResult, pageResult] = await Promise.all([countQuery, pageQuery]);

  if (countResult.error) {
    throw new Error(
      `강좌 목록 카운트에 실패했습니다: ${countResult.error.message}`,
    );
  }
  if (pageResult.error) {
    throw new Error(
      `강좌 목록 조회에 실패했습니다: ${pageResult.error.message}`,
    );
  }

  const total = countResult.count ?? 0;
  const classRows = (pageResult.data ?? []) as ClassRow[];

  // (3) 강좌별 수강생 수 집계 — 페이지의 aca_class_id 만 모아 한 번에 조회.
  const enrolledCountByAcaId = await fetchEnrolledStudentCounts(
    supabase,
    classRows,
  );

  const rows: ClassListItem[] = classRows.map((c) => ({
    ...c,
    enrolled_student_count:
      c.aca_class_id !== null
        ? (enrolledCountByAcaId.get(c.aca_class_id) ?? 0)
        : 0,
  }));

  return {
    rows,
    total,
    page,
    pageSize,
  };
}

/**
 * classes 쿼리에 ClassFilters 를 일관되게 적용.
 * count·page 쿼리 양쪽이 동일한 필터셋을 갖도록 한 곳에 모은다.
 *
 * 제네릭으로 쿼리 빌더 타입을 보존해 호출부의 .order/.range/.select 가
 * 그대로 이어지도록 한다 (any 미사용).
 */
function applyClassFilters<Q extends ClassQueryBuilder>(
  query: Q,
  filters: ClassFilters,
): Q {
  let q = query;

  if (filters.branch && filters.branch !== "") {
    q = q.eq("branch", filters.branch) as Q;
  }

  if (filters.subject) {
    // DB CHECK 가 4종 enum 이라 안전 (수학/국어/영어/탐구).
    q = q.eq("subject", filters.subject) as Q;
  }

  // active=true 가 명시되면 미사용 강좌 숨김. false 면 모두 표시 (필터 미적용).
  if (filters.active === true) {
    q = q.eq("active", true) as Q;
  }

  if (filters.search && filters.search !== "") {
    const safe = sanitizeSearchTerm(filters.search);
    if (safe.length > 0) {
      const like = `%${safe}%`;
      // 반명 + 강사명 OR 검색.
      q = q.or(`name.ilike.${like},teacher_name.ilike.${like}`) as Q;
    }
  }

  return q;
}

/**
 * 페이지 강좌들의 수강생 수를 한 번의 쿼리로 집계.
 *
 * - 입력: 페이지의 ClassRow 들.
 * - 출력: Map<aca_class_id, distinct_student_count>.
 * - 빈 입력이면 빈 Map 즉시 반환 (PostgREST 빈 in 절 회피).
 *
 * 규모 가정: 페이지당 강좌 ≤ 200, 강좌당 평균 enrollment ≤ 100 정도 →
 * JS distinct 집계로 충분 (≤ 20k 행, 메모리 무시 가능).
 */
async function fetchEnrolledStudentCounts(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  classRows: ClassRow[],
): Promise<Map<string, number>> {
  const acaClassIds = classRows
    .map((c) => c.aca_class_id)
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  if (acaClassIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("enrollments")
    .select("aca_class_id, student_id")
    .in("aca_class_id", acaClassIds);

  if (error) {
    throw new Error(
      `강좌별 수강생 집계에 실패했습니다: ${error.message}`,
    );
  }

  // aca_class_id → Set<student_id> 로 distinct 집계.
  const studentSetByAcaId = new Map<string, Set<string>>();
  for (const row of (data ?? []) as Array<{
    aca_class_id: string | null;
    student_id: string;
  }>) {
    if (!row.aca_class_id) continue;
    let set = studentSetByAcaId.get(row.aca_class_id);
    if (!set) {
      set = new Set<string>();
      studentSetByAcaId.set(row.aca_class_id, set);
    }
    set.add(row.student_id);
  }

  // Set → count 로 변환.
  const countByAcaId = new Map<string, number>();
  for (const [acaId, set] of studentSetByAcaId) {
    countByAcaId.set(acaId, set.size);
  }
  return countByAcaId;
}

/**
 * applyClassFilters 의 제네릭 제약용 minimal 쿼리 빌더 인터페이스.
 *
 * Supabase JS 의 PostgrestFilterBuilder 는 select 모드(head/count)에 따라
 * 결과 타입이 분기되지만, 우리가 쓰는 메서드는 .eq/.or 뿐이므로 그 두 개만
 * 노출해 호출부 타입을 보존한다 (any 회피).
 */
interface ClassQueryBuilder {
  eq(column: string, value: string | boolean): ClassQueryBuilder;
  or(filters: string): ClassQueryBuilder;
}
