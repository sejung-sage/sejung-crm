"use server";

/**
 * 데이터 탐색기(/explorer) 서버 액션 — 읽기 전용.
 *
 * 안전 원칙:
 *  1. master 전용. 모든 액션이 getCurrentUser().role === "master" 재확인.
 *  2. 데이터셋은 화이트리스트(EXPLORER_DATASETS)로만. 그 외 테이블 접근 불가.
 *  3. SELECT 만. insert/update/delete/rpc 경로 자체가 없다.
 *  4. 필터/정렬/표시 컬럼은 introspect 한 실제 컬럼 집합과 대조해 검증
 *     (PostgREST 필터 인젝션 방지). 값은 항상 파라미터로 전달.
 *
 * service client(RLS 우회)로 읽는다 — master 전용 + aca_* raw 는 RLS 미설정이라.
 */

import { getCurrentUser } from "@/lib/auth/current-user";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { isAllowedDataset } from "@/lib/explorer/datasets";
import {
  ExplorerQuerySchema,
  type ExplorerFilter,
} from "@/lib/schemas/explorer";
import { listStudents } from "@/lib/profile/list-students";
import { ListStudentsInputSchema } from "@/lib/schemas/student";

export interface ExplorerRunResult {
  ok: boolean;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  /** 매칭 추정 건수(대용량은 planner estimate). */
  total: number | null;
  page: number;
  pageSize: number;
  error?: string;
}

async function assertMaster(): Promise<boolean> {
  if (isDevSeedMode()) return true; // 로컬 dev-seed 는 통과(시뮬레이션 로그인).
  const user = await getCurrentUser();
  return user?.role === "master";
}

/** 샘플 1행의 키로 컬럼 목록을 얻는다(introspect). 빈 테이블이면 빈 배열. */
async function introspectColumns(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  dataset: string,
): Promise<string[]> {
  const { data, error } = await supabase.from(dataset).select("*").limit(1);
  if (error || !data || data.length === 0) return [];
  return Object.keys(data[0] as Record<string, unknown>);
}

/**
 * 데이터셋 컬럼 목록 조회. 클라이언트가 데이터셋 선택 시 호출 →
 * 필터 빌더·컬럼 선택 UI 의 옵션으로 사용.
 */
export async function describeDatasetAction(
  dataset: string,
): Promise<{ ok: boolean; columns: string[]; error?: string }> {
  if (!(await assertMaster())) {
    return { ok: false, columns: [], error: "master 전용 페이지입니다." };
  }
  if (!isAllowedDataset(dataset)) {
    return { ok: false, columns: [], error: "허용되지 않은 데이터셋입니다." };
  }
  const supabase = createSupabaseServiceClient();
  const columns = await introspectColumns(supabase, dataset);
  return { ok: true, columns };
}

/** student_profiles 전 컬럼(빈 결과일 때 헤더 폴백용). */
const STUDENT_COLUMNS = [
  "id", "name", "school", "grade", "grade_raw", "school_level", "status",
  "branch", "parent_phone", "phone", "registered_at", "enrollment_count",
  "active_enrollment_count", "total_paid", "subjects", "teachers",
  "attendance_rate", "absent_count", "last_attended_at", "last_paid_at",
  "region",
];

/**
 * 학생(student_profiles) 전용 빠른 조회 — CRM /students 와 동일한 listStudents
 * 파이프라인(2단계 + RPC) 재사용. 뷰를 직접 정렬·풀집계하면 107k×무거운 서브쿼리로
 * 느려지므로, 일반 탐색 액션 대신 이 경로를 쓴다.
 *
 * 프리셋 → ListStudentsInput 매핑. 값 검증(과목/학년/상태 enum, pageSize 상한)은
 * ListStudentsInputSchema 가 담당.
 */
export async function runStudentExplorerAction(input: {
  search?: string;
  branch?: string;
  level?: string;
  grades?: string[];
  statuses?: string[];
  subjects?: string[];
  regions?: string[];
  sort?: string;
  page?: number;
  pageSize?: number;
}): Promise<ExplorerRunResult> {
  const fail = (error: string): ExplorerRunResult => ({
    ok: false, columns: STUDENT_COLUMNS, rows: [], total: null,
    page: 1, pageSize: 100, error,
  });
  if (!(await assertMaster())) return fail("master 전용 페이지입니다.");

  const parsedInput = ListStudentsInputSchema.safeParse({
    search: input.search ?? "",
    branch:
      input.branch && input.branch !== "전체" ? input.branch : undefined,
    grades: input.grades ?? [],
    schoolLevels:
      input.level && input.level !== "전체" ? [input.level] : [],
    statuses: input.statuses ?? [],
    subjects: input.subjects ?? [],
    regions: input.regions ?? [],
    includeHidden: true, // 탐색기는 졸업·미정도 기본 노출.
    sort: input.sort,
    page: input.page ?? 1,
    pageSize: input.pageSize ?? 100,
  });
  if (!parsedInput.success) return fail("입력값이 올바르지 않습니다.");

  try {
    const r = await listStudents(parsedInput.data);
    const columns =
      r.rows.length > 0
        ? Object.keys(r.rows[0] as unknown as Record<string, unknown>)
        : STUDENT_COLUMNS;
    return {
      ok: true,
      columns,
      rows: r.rows as unknown as Array<Record<string, unknown>>,
      total: r.total,
      page: r.page,
      pageSize: r.pageSize,
    };
  } catch (e) {
    return fail(
      `조회 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`,
    );
  }
}

/** PostgREST 빌더의 좁힌 인터페이스 — 동적 필터 체이닝용(strict, any 회피). */
interface FilterableQuery {
  eq(c: string, v: unknown): FilterableQuery;
  neq(c: string, v: unknown): FilterableQuery;
  gt(c: string, v: unknown): FilterableQuery;
  gte(c: string, v: unknown): FilterableQuery;
  lt(c: string, v: unknown): FilterableQuery;
  lte(c: string, v: unknown): FilterableQuery;
  ilike(c: string, v: string): FilterableQuery;
  in(c: string, v: readonly unknown[]): FilterableQuery;
  overlaps(c: string, v: readonly string[]): FilterableQuery;
  is(c: string, v: null): FilterableQuery;
  not(c: string, op: string, v: null): FilterableQuery;
  order(
    c: string,
    o: { ascending: boolean; nullsFirst: boolean },
  ): FilterableQuery;
  range(
    from: number,
    to: number,
  ): PromiseLike<{
    data: Array<Record<string, unknown>> | null;
    count: number | null;
    error: { message: string } | null;
  }>;
}

function applyFilter(
  q: FilterableQuery,
  f: ExplorerFilter,
): FilterableQuery {
  const v = f.value ?? "";
  switch (f.operator) {
    case "eq":
      return q.eq(f.column, v);
    case "neq":
      return q.neq(f.column, v);
    case "ilike":
      return q.ilike(f.column, `%${v}%`);
    case "gt":
      return q.gt(f.column, v);
    case "gte":
      return q.gte(f.column, v);
    case "lt":
      return q.lt(f.column, v);
    case "lte":
      return q.lte(f.column, v);
    case "in":
      return q.in(
        f.column,
        v
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      );
    case "overlaps":
      return q.overlaps(
        f.column,
        v
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      );
    case "is_null":
      return q.is(f.column, null);
    case "not_null":
      return q.not(f.column, "is", null);
    default:
      return q;
  }
}

/**
 * 탐색 쿼리 실행. 화이트리스트 데이터셋에서 필터/정렬/페이지를 적용해 행을 반환.
 * 컬럼명은 introspect 한 실제 컬럼과 대조 — 없는 컬럼 필터/정렬은 무시(인젝션 방지).
 */
export async function runExplorerQueryAction(
  rawInput: unknown,
): Promise<ExplorerRunResult> {
  const empty = (error: string): ExplorerRunResult => ({
    ok: false,
    columns: [],
    rows: [],
    total: null,
    page: 1,
    pageSize: 100,
    error,
  });

  if (!(await assertMaster())) return empty("master 전용 페이지입니다.");

  const parsed = ExplorerQuerySchema.safeParse(rawInput);
  if (!parsed.success) {
    return empty("입력값이 올바르지 않습니다.");
  }
  const input = parsed.data;
  if (!isAllowedDataset(input.dataset)) {
    return empty("허용되지 않은 데이터셋입니다.");
  }

  const supabase = createSupabaseServiceClient();
  const actualColumns = await introspectColumns(supabase, input.dataset);
  const colSet = new Set(actualColumns);

  // 표시 컬럼: 요청 중 실제 존재하는 것만. 없으면 전체(*).
  const selectCols = input.columns.filter((c) => colSet.has(c));
  const selectExpr = selectCols.length > 0 ? selectCols.join(",") : "*";

  // estimated: 대용량(aca_tickets 46만 등)에서 exact count 가 timeout 나는 것 방지.
  let q = supabase
    .from(input.dataset)
    .select(selectExpr, { count: "estimated" }) as unknown as FilterableQuery;

  for (const f of input.filters) {
    if (!colSet.has(f.column)) continue; // 없는 컬럼 필터는 무시.
    q = applyFilter(q, f);
  }

  if (input.sortColumn && colSet.has(input.sortColumn)) {
    q = q.order(input.sortColumn, {
      ascending: input.sortAsc,
      nullsFirst: false,
    });
  }

  const from = (input.page - 1) * input.pageSize;
  const to = from + input.pageSize - 1;

  const { data, count, error } = await q.range(from, to);

  if (error) {
    return {
      ...empty(`조회 실패: ${error.message}`),
      page: input.page,
      pageSize: input.pageSize,
    };
  }

  const rows = data ?? [];
  // 표시 컬럼 순서: 선택했으면 그 순서, 아니면 첫 행 키(=introspect 순서).
  const columns =
    selectCols.length > 0
      ? selectCols
      : rows.length > 0
        ? Object.keys(rows[0])
        : actualColumns;

  return {
    ok: true,
    columns,
    rows,
    total: count,
    page: input.page,
    pageSize: input.pageSize,
  };
}
