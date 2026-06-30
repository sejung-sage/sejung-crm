import { unstable_cache } from "next/cache";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import type { StudentProfileRow } from "@/types/database";
import type { ListStudentsInput, StudentSort } from "@/lib/schemas/student";
import {
  HIDDEN_GRADES_BY_DEFAULT,
  UNMAPPED_SCHOOL_PATTERNS,
} from "@/lib/schemas/common";

/**
 * '학교 미등록' 필터 PostgREST `.or(...)` 표현식.
 * school IS NULL OR school IN (placeholder set).
 * 입력 값(고/중/대학교 등)은 한글이지만 메타문자 없음 — 인젝션 안전.
 *
 * 학생 명단·발송 그룹 양쪽이 동일 헬퍼 사용 — 매칭 결과 1:1 일치.
 */
export const UNMAPPED_SCHOOL_OR_EXPR = `school.is.null,school.in.(${UNMAPPED_SCHOOL_PATTERNS.join(",")})`;
/**
 * '학교 등록만' = 위 반대. school IS NOT NULL AND school NOT IN placeholder set.
 * PostgREST chain: q.not('school','is','null').not('school','in','(...)').
 * 학생 명단·발송 그룹 양쪽 공통 헬퍼.
 */
export function applyMappedSchoolFilter<
  Q extends {
    not: (col: string, op: string, val: string) => Q;
  },
>(q: Q): Q {
  return q
    .not("school", "is", "null")
    .not("school", "in", `(${UNMAPPED_SCHOOL_PATTERNS.join(",")})`);
}
import {
  DEV_ENROLLMENTS,
  DEV_STUDENT_PROFILES,
  isDevSeedMode,
} from "./students-dev-seed";

/**
 * 검색어가 전화번호 형태(숫자+구분자만)면 하이픈·공백을 제거한 숫자열을,
 * 아니면(이름·학교 검색) null 을 반환한다.
 *
 * parent_phone 은 DB 에 하이픈 없는 숫자(01074667133)로 저장되므로,
 * '010-7466-7133' 처럼 입력해도 매칭되게 정규화한다. '3학년'처럼 한글이
 * 섞인 검색은 null 이라 전화번호 부분일치 노이즈를 막는다.
 */
function phoneDigitsForSearch(search: string): string | null {
  const digits = search.replace(/\D/g, "");
  if (digits.length === 0) return null;
  // 숫자·공백·하이픈·괄호·+ 외 문자가 있으면 전화번호 검색이 아님.
  if (/[^\d\s()+-]/.test(search)) return null;
  return digits;
}

/**
 * 학생 검색 `.or(...)` 표현식. 이름·학교는 입력 그대로 부분일치하고,
 * 전화번호는 phoneDigitsForSearch 로 정규화해 매칭한다.
 * 학생 명단의 count/본 쿼리/2단계 fetch 가 동일 식을 써 결과 1:1 일치.
 */
function buildStudentSearchOr(search: string): string {
  const like = `%${search}%`;
  const digits = phoneDigitsForSearch(search);
  const phoneClause = digits
    ? `parent_phone.ilike.%${digits}%`
    : `parent_phone.ilike.${like}`;
  return `name.ilike.${like},school.ilike.${like},${phoneClause}`;
}

/**
 * school_regions 매핑은 거의 정적 (운영자가 가끔 수동 갱신).
 * region → schools 변환을 매 요청마다 페치하지 않도록 service client + 300s 캐시.
 *
 * 캐시 무효화: /regions admin 페이지의 upsert/delete server action 에서
 * revalidateTag("school-regions") 호출 (이미 적용된 곳은 그대로 두고,
 * 누락 시점에는 5분 지연 허용 — 운영상 학교명 매핑 변경이 즉시 반영될 필요 없음).
 */
const cachedRegionToSchools = unstable_cache(
  async (regions: string[]): Promise<{ explicit: string[]; all: string[] }> => {
    const serviceSupabase = createSupabaseServiceClient();
    const knownRegions = regions.filter((r) => r !== "기타");
    const includeEtc = regions.includes("기타");

    const [explicitRes, allRes] = await Promise.all([
      knownRegions.length > 0
        ? serviceSupabase
            .from("crm_school_regions")
            .select("school")
            .in("region", knownRegions)
        : Promise.resolve({ data: [] as Array<{ school: string }> }),
      includeEtc
        ? serviceSupabase.from("crm_school_regions").select("school")
        : Promise.resolve({ data: [] as Array<{ school: string }> }),
    ]);

    return {
      explicit: ((explicitRes.data ?? []) as Array<{ school: string }>).map(
        (r) => r.school,
      ),
      all: ((allRes.data ?? []) as Array<{ school: string }>).map(
        (r) => r.school,
      ),
    };
  },
  ["list-students-region-mapping-v1"],
  { revalidate: 300, tags: ["school-regions"] },
);

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

  // ─── region/subjects 필터 → RPC 경로 위임 ─────────────────
  // 두 필터 모두 students 베이스 단순 쿼리로는 못 푼다:
  //   - region: 매핑 학교가 수십~수백 개라 school IN/NOT IN 인자가 PostgREST URL
  //     한계(~8KB) 초과 가능(현장 회귀).
  //   - subjects: 과목은 view 집계 컬럼이라 .overlaps 가 60k view 풀집계를 유발 →
  //     전체 분원에서 statement_timeout(과목당 38~55초) → 학생 명단 오류(2026-06-30).
  // 둘 중 하나라도 있으면 search_students_by_region RPC(0098)로 매칭 id+total 만
  // 받아(students 베이스 + EXISTS 조인, 빠름) 그 50행만 view 에서 materialize 한다.
  if (input.regions.length > 0 || input.subjects.length > 0) {
    return await fetchViaView({ supabase, input, from, to });
  }
  // 그 아래 흐름은 region/subjects 필터가 없는 케이스만 도달. regionPlan 은 항상 null.
  const regionPlan: RegionPlan | null = null;

  // ─── count 쿼리 (students 베이스, head + exact) ───────────
  // 핫픽스 (2026-05-15):
  //   기존 count: "estimated" 가 student_profiles 뷰의 stale planner 통계 때문에
  //   필터와 무관하게 항상 1001 같은 값으로 stuck 되었음. 사용자가 어떤 region/학교를
  //   선택해도 "1,001명" 표시 → 카운트 무의미.
  //   해결: count 만 가벼운 students 테이블에서 head + exact 로 분리. 본 select 는
  //   student_profiles 뷰 유지 (출석률·수강 정보 등 집계 컬럼 필요).
  //
  //   subjects/teachers 필터는 학생 명단 UI 에서 노출 안 되지만 URL 직접 진입 시
  //   적용될 수 있음. students 베이스로는 정확 count 불가 — 그 경우 count 는
  //   "필터 적용 전 학생 수" 가 되어 보수적으로 과대. 대안은 enrollments JOIN 인데
  //   학생 명단 메인 화면 케이스가 아니라 그냥 허용.
  let countQuery = supabase
    .from("crm_students")
    .select("id", { count: "exact", head: true });

  if (input.search) {
    countQuery = countQuery.or(buildStudentSearchOr(input.search));
  }
  if (input.branch && input.branch !== "전체") {
    countQuery = countQuery.eq("branch", input.branch);
  }
  if (input.grades.length > 0) {
    countQuery = countQuery.in("grade", input.grades);
  }
  if (input.schoolLevels.length > 0) {
    countQuery = countQuery.in("school_level", input.schoolLevels);
  }
  if (input.statuses.length > 0) {
    countQuery = countQuery.in("status", input.statuses);
  }
  if (input.schools.length > 0) {
    countQuery = countQuery.in("school", input.schools);
  }
  // 학교 미등록/등록 필터. 두 토글 동시 true 는 모순 — unmapped 우선.
  if (input.unmappedSchool) {
    countQuery = countQuery.or(UNMAPPED_SCHOOL_OR_EXPR);
  } else if (input.mappedSchool) {
    countQuery = applyMappedSchoolFilter(countQuery);
  }
  if (regionPlan) {
    countQuery = applyRegionPlanToCount(countQuery, regionPlan);
  }
  if (!input.includeHidden && input.grades.length === 0) {
    countQuery = countQuery.not(
      "grade",
      "in",
      `(${HIDDEN_GRADES_BY_DEFAULT.join(",")})`,
    );
  }

  // ─── 본 데이터 fetch 전략 분기 ────────────────────────────
  // 2단계 fetch (성능 핵심, 0046):
  //   정렬 키가 students 컬럼이고 subjects/teachers 필터가 없으면 → 1단계로
  //   students 에서 id+필터+정렬+페이지 좁힘(인덱스 활용 가능) → 2단계로
  //   student_profiles 에서 그 id 들만 IN(...) 으로 view 작은 set materialize.
  //   학생 60k 뷰 풀스캔 → 50 row 만 view → 100배 이상 빨라짐.
  //
  // view 직접 fetch (fallback):
  //   - 정렬이 view 컬럼(attendance_rate/enrollment_count/total_paid)일 때.
  //   - subjects/teachers 필터가 활성화될 때 (학생 UI 노출 안 되지만 URL fallback).
  const canUseTwoStage =
    isStudentsColumnSort(input.sort) &&
    input.subjects.length === 0 &&
    input.teachers.length === 0;

  if (canUseTwoStage) {
    return await fetchTwoStage({
      supabase,
      input,
      from,
      to,
      regionPlan,
      countQuery,
    });
  }

  // ─── 본 select (student_profiles 뷰 직접) ─────────────────
  let query = supabase.from("student_profiles").select("*");

  if (input.search) {
    query = query.or(buildStudentSearchOr(input.search));
  }

  if (input.branch && input.branch !== "전체") {
    query = query.eq("branch", input.branch);
  }

  if (input.grades.length > 0) {
    query = query.in("grade", input.grades);
  }

  if (input.schoolLevels.length > 0) {
    query = query.in("school_level", input.schoolLevels);
  }

  if (input.statuses.length > 0) {
    query = query.in("status", input.statuses);
  }

  // 수강 과목 필터 — student_profiles.subjects (text[]) 와 교집합.
  if (input.subjects.length > 0) {
    query = query.overlaps("subjects", input.subjects);
  }

  // 강사명 필터 — student_profiles.teachers (text[]) 와 교집합.
  if (input.teachers.length > 0) {
    query = query.overlaps("teachers", input.teachers);
  }

  // 학교 필터 — students.school (뷰에 그대로 노출) 정확 일치.
  if (input.schools.length > 0) {
    query = query.in("school", input.schools);
  }
  if (input.unmappedSchool) {
    query = query.or(UNMAPPED_SCHOOL_OR_EXPR);
  } else if (input.mappedSchool) {
    query = applyMappedSchoolFilter(query);
  }

  // 지역 필터 — student_profiles.region (school_regions 매핑) 정확 일치.
  if (input.regions.length > 0) {
    query = query.in("region", input.regions);
  }

  // 기본 숨김
  if (!input.includeHidden && input.grades.length === 0) {
    query = query.not(
      "grade",
      "in",
      `(${HIDDEN_GRADES_BY_DEFAULT.join(",")})`,
    );
  }

  query = applySupabaseSort(query, input.sort);

  const [countResult, dataResult] = await Promise.all([
    countQuery,
    query.range(from, to),
  ]);

  if (dataResult.error) {
    throw new Error(`학생 목록 조회에 실패했습니다: ${dataResult.error.message}`);
  }

  const total = countResult.error ? 0 : (countResult.count ?? 0);

  return {
    rows: (dataResult.data ?? []) as StudentProfileRow[],
    total,
    page: input.page,
    pageSize: input.pageSize,
    source: "supabase",
  };
}

/**
 * region/subjects 필터 fallback — SECURITY INVOKER RPC `search_students_by_region`
 * (0067/0098 마이그) 호출. crm_students 베이스에서 region(school_regions LEFT JOIN)
 * 과 subjects(현재 진행 중 enrollments JOIN classes EXISTS)를 SQL 단에서 직접
 * 처리하므로 PostgREST URL 폭주와 view 집계 컬럼 overlaps 의 풀집계 statement_timeout
 * 을 모두 회피한다.
 *
 * RPC 가 반환한 id 와 total_count 를 받아, 그 id 만 student_profiles 뷰에서
 * IN(...) 으로 작은 set materialize. view 풀집계 안 함.
 */
async function fetchViaView(args: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  input: ListStudentsInput;
  from: number;
  to: number;
}): Promise<ListStudentsResult> {
  const { supabase, input, from, to } = args;

  // RPC 호출 — sort 키는 SQL 단에서 매핑. attendance_rate 등 폐기된 키는 fallback.
  // RPC 타입 정의는 database.ts 의 Functions 미정의라 supabase JS generic 우회 캐스팅.
  const rpcResult = await (
    supabase.rpc as unknown as (
      fn: "search_students_by_region",
      params: {
        p_regions: string[];
        p_branch: string | null;
        p_search: string | null;
        p_grades: string[] | null;
        p_school_levels: string[] | null;
        p_statuses: string[] | null;
        p_schools: string[] | null;
        p_include_hidden: boolean;
        p_sort: string;
        p_offset: number;
        p_limit: number;
        p_subjects: string[] | null;
        p_subjects_match_all: boolean;
      },
    ) => Promise<{
      data: Array<{ id: string; total_count: number }> | null;
      error: { message: string } | null;
    }>
  )("search_students_by_region", {
    p_regions: input.regions,
    p_branch: input.branch && input.branch !== "전체" ? input.branch : null,
    p_search: input.search?.trim() ? input.search.trim() : null,
    p_grades: input.grades.length > 0 ? input.grades : null,
    p_school_levels:
      input.schoolLevels.length > 0 ? input.schoolLevels : null,
    p_statuses: input.statuses.length > 0 ? input.statuses : null,
    p_schools: input.schools.length > 0 ? input.schools : null,
    p_include_hidden: input.includeHidden,
    p_sort: input.sort,
    p_offset: from,
    p_limit: to - from + 1,
    p_subjects: input.subjects.length > 0 ? input.subjects : null,
    p_subjects_match_all: input.subjectsMatchAll,
  });

  if (rpcResult.error) {
    throw new Error(
      `학생 목록 조회에 실패했습니다: ${rpcResult.error.message}`,
    );
  }
  const rpcRows = (rpcResult.data ?? []) as Array<{
    id: string;
    total_count: number;
  }>;
  const ids = rpcRows.map((r) => r.id);
  const total = rpcRows[0]?.total_count ?? 0;

  if (ids.length === 0) {
    return {
      rows: [],
      total,
      page: input.page,
      pageSize: input.pageSize,
      source: "supabase",
    };
  }

  // 2단계: student_profiles 뷰에서 그 id 들만 materialize. small set 이라 풀집계 회피.
  let profilesQuery = supabase
    .from("student_profiles")
    .select("*")
    .in("id", ids);
  profilesQuery = applySupabaseSort(profilesQuery, input.sort);

  const profilesResult = await profilesQuery;
  if (profilesResult.error) {
    throw new Error(
      `학생 목록 조회에 실패했습니다: ${profilesResult.error.message}`,
    );
  }

  return {
    rows: (profilesResult.data ?? []) as StudentProfileRow[],
    total,
    page: input.page,
    pageSize: input.pageSize,
    source: "supabase",
  };
}

/**
 * 정렬 키가 students 테이블 컬럼이라 1단계에서 students 인덱스 활용 가능한지.
 * enrollment_count / active_enrollment_count / total_paid 는 view 집계 컬럼이라 X.
 */
function isStudentsColumnSort(sort: StudentSort): boolean {
  switch (sort) {
    case "registered_desc":
    case "registered_asc":
    case "name_asc":
    case "name_desc":
      return true;
    case "enrollment_count_desc":
    case "active_enrollment_count_desc":
    case "total_paid_desc":
      return false;
  }
}

/** 2단계 fetch: students 에서 id 좁힘 → student_profiles 작은 set 만 materialize. */
async function fetchTwoStage(args: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  input: ListStudentsInput;
  from: number;
  to: number;
  regionPlan: RegionPlan | null;
  countQuery: CountBuilder;
}): Promise<ListStudentsResult> {
  const { supabase, input, from, to, regionPlan, countQuery } = args;

  // 1단계: students 에서 id 만 — 인덱스(0046) 가속.
  let idsQuery = supabase.from("crm_students").select("id");

  if (input.search) {
    idsQuery = idsQuery.or(buildStudentSearchOr(input.search));
  }
  if (input.branch && input.branch !== "전체") {
    idsQuery = idsQuery.eq("branch", input.branch);
  }
  if (input.grades.length > 0) {
    idsQuery = idsQuery.in("grade", input.grades);
  }
  if (input.schoolLevels.length > 0) {
    idsQuery = idsQuery.in("school_level", input.schoolLevels);
  }
  if (input.statuses.length > 0) {
    idsQuery = idsQuery.in("status", input.statuses);
  }
  if (input.schools.length > 0) {
    idsQuery = idsQuery.in("school", input.schools);
  }
  if (input.unmappedSchool) {
    idsQuery = idsQuery.or(UNMAPPED_SCHOOL_OR_EXPR);
  } else if (input.mappedSchool) {
    idsQuery = applyMappedSchoolFilter(idsQuery);
  }
  if (regionPlan) {
    idsQuery = applyRegionPlanToCount(idsQuery, regionPlan);
  }
  if (!input.includeHidden && input.grades.length === 0) {
    idsQuery = idsQuery.not(
      "grade",
      "in",
      `(${HIDDEN_GRADES_BY_DEFAULT.join(",")})`,
    );
  }

  idsQuery = applyStudentsSort(idsQuery, input.sort);

  // count + 1단계 ids 병렬. CountBuilder 는 thenable 이지만 좁힌 인터페이스에
  // await 결과 타입이 없어 캐스팅.
  type CountAwaited = {
    count: number | null;
    error: { message: string } | null;
  };
  const [countResult, idsResult] = await Promise.all([
    countQuery as unknown as Promise<CountAwaited>,
    idsQuery.range(from, to),
  ]);

  if (idsResult.error) {
    throw new Error(
      `학생 목록 조회에 실패했습니다: ${idsResult.error.message}`,
    );
  }

  const idsRows = (idsResult.data ?? []) as Array<{ id: string }>;
  const ids = idsRows.map((r) => r.id);
  const total = countResult.error ? 0 : (countResult.count ?? 0);

  if (ids.length === 0) {
    return {
      rows: [],
      total,
      page: input.page,
      pageSize: input.pageSize,
      source: "supabase",
    };
  }

  // 2단계: student_profiles 에서 그 id 들만 view materialize.
  // PostgreSQL IN 은 순서 보존 안 함 → 같은 정렬 키로 view 단에서 한 번 더 정렬.
  let profilesQuery = supabase
    .from("student_profiles")
    .select("*")
    .in("id", ids);
  profilesQuery = applySupabaseSort(profilesQuery, input.sort);

  const profilesResult = await profilesQuery;
  if (profilesResult.error) {
    throw new Error(
      `학생 목록 조회에 실패했습니다: ${profilesResult.error.message}`,
    );
  }

  return {
    rows: (profilesResult.data ?? []) as StudentProfileRow[],
    total,
    page: input.page,
    pageSize: input.pageSize,
    source: "supabase",
  };
}

/**
 * students 테이블 쿼리용 order 적용 (registered_at / name 정렬만).
 * view 의 attendance_rate 등은 처리하지 않음 — 호출 전 isStudentsColumnSort 로 가드.
 */
function applyStudentsSort<Q extends ProfilesOrderBuilder>(
  query: Q,
  sort: StudentSort,
): Q {
  switch (sort) {
    case "registered_desc":
      return query.order("registered_at", {
        ascending: false,
        nullsFirst: false,
      }) as Q;
    case "registered_asc":
      return query.order("registered_at", {
        ascending: true,
        nullsFirst: false,
      }) as Q;
    case "name_asc":
      return query
        .order("name", { ascending: true })
        .order("registered_at", { ascending: false, nullsFirst: false }) as Q;
    case "name_desc":
      return query
        .order("name", { ascending: false })
        .order("registered_at", { ascending: false, nullsFirst: false }) as Q;
    default:
      // view 컬럼 정렬은 fetchTwoStage 호출 안 됨. 안전 fallback.
      return query.order("registered_at", {
        ascending: false,
        nullsFirst: false,
      }) as Q;
  }
}

// ─── region 필터 변환 ───────────────────────────────────────

interface RegionPlan {
  /** 사용자가 명시 선택한 지역(기타 제외) 에 매핑된 학교들. */
  explicitSchools: string[];
  /** '기타' 가 선택되어 있는지. true 면 매핑 안 된 학교 + NULL school 도 포함. */
  includeEtc: boolean;
  /** 전체 매핑 학교 목록 — '기타' 정의를 위한 NOT IN 보조용. */
  allMappedSchools: string[];
}

async function resolveRegionToSchools(
  regions: string[],
): Promise<RegionPlan | null> {
  if (regions.length === 0) return null;

  // 캐시화된 region → schools 매핑. 운영 중 학교명 변경은 빈도가 낮아 5분 캐시로
  // 충분. /regions admin 액션에서 revalidateTag("school-regions") 가능.
  // 정렬된 normalized key 로 캐시 hit-rate 향상.
  const normalized = [...regions].sort();
  const { explicit, all } = await cachedRegionToSchools(normalized);

  return {
    explicitSchools: explicit,
    includeEtc: regions.includes("기타"),
    allMappedSchools: all,
  };
}

/**
 * PostgREST count 쿼리에 region plan 을 학교 IN/NOT IN 절로 적용.
 *
 * 케이스:
 *  - 명시 지역만 → school IN (explicit)
 *  - '기타' 만   → school IS NULL OR school NOT IN (allMapped)
 *  - 혼합        → school IN (explicit) OR school IS NULL OR school NOT IN (allMapped)
 *
 * 학교명에 쉼표·괄호·따옴표가 들어가면 PostgREST `.in.()` 문법이 깨질 수 있으나,
 * 실제 운영 학교명에 그런 문자가 없다는 가정 하에 단순 join 처리.
 */
interface CountBuilder {
  in(column: string, values: readonly string[]): CountBuilder;
  or(filter: string): CountBuilder;
  eq(column: string, value: string): CountBuilder;
}

function applyRegionPlanToCount<Q extends CountBuilder>(
  query: Q,
  plan: RegionPlan,
): Q {
  const { explicitSchools, includeEtc, allMappedSchools } = plan;

  if (!includeEtc) {
    if (explicitSchools.length === 0) {
      // 명시 지역인데 매핑 학교 0개 → 매칭 학생 0명 강제.
      return query.eq("school", "__never_match__") as Q;
    }
    return query.in("school", explicitSchools) as Q;
  }

  // includeEtc === true
  if (explicitSchools.length === 0) {
    // '기타' 만.
    if (allMappedSchools.length === 0) {
      // 매핑 0건이면 모든 학생이 사실상 기타 → 추가 필터 없음.
      return query;
    }
    return query.or(
      `school.is.null,school.not.in.(${allMappedSchools.join(",")})`,
    ) as Q;
  }

  // 혼합. or() 안에 모든 조건 한 번에.
  const orExpr = [
    `school.in.(${explicitSchools.join(",")})`,
    `school.is.null`,
    allMappedSchools.length > 0
      ? `school.not.in.(${allMappedSchools.join(",")})`
      : null,
  ]
    .filter((v): v is string => v !== null)
    .join(",");
  return query.or(orExpr) as Q;
}

// ─── 정렬 ───────────────────────────────────────────────────

/**
 * Supabase 쿼리에 정렬을 분기 적용한다.
 *
 * NULLS 정책: ASC/DESC 모두 NULL 은 항상 뒤(NULLS LAST). Supabase JS 의
 * `nullsFirst: false` 옵션이 SQL `NULLS LAST` 로 매핑되며, attendance_rate /
 * registered_at 처럼 NULL 가능 컬럼에서 빈 값을 위로 끌어올리지 않기 위함.
 *
 * 안정 정렬: 1차 키 동률 시 registered_at DESC 를 보조 키로 적용해
 * 동명이인·동일 출석률 학생의 순서를 일관되게 유지.
 */
interface ProfilesOrderBuilder {
  order(
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean },
  ): ProfilesOrderBuilder;
}

function applySupabaseSort<Q extends ProfilesOrderBuilder>(
  query: Q,
  sort: StudentSort,
): Q {
  const tieBreaker = (q: Q): Q =>
    q.order("registered_at", {
      ascending: false,
      nullsFirst: false,
    }) as Q;

  switch (sort) {
    case "registered_desc":
      return query.order("registered_at", {
        ascending: false,
        nullsFirst: false,
      }) as Q;
    case "registered_asc":
      return query.order("registered_at", {
        ascending: true,
        nullsFirst: false,
      }) as Q;
    case "name_asc":
      return tieBreaker(query.order("name", { ascending: true }) as Q);
    case "name_desc":
      return tieBreaker(query.order("name", { ascending: false }) as Q);
    case "enrollment_count_desc":
      return tieBreaker(
        query.order("enrollment_count", {
          ascending: false,
          nullsFirst: false,
        }) as Q,
      );
    case "active_enrollment_count_desc":
      // 0060 view 추가 컬럼 — 진행 중 강좌가 많은 학생부터.
      return tieBreaker(
        query.order("active_enrollment_count", {
          ascending: false,
          nullsFirst: false,
        }) as Q,
      );
    case "total_paid_desc":
      return tieBreaker(
        query.order("total_paid", {
          ascending: false,
          nullsFirst: false,
        }) as Q,
      );
    default: {
      const _exhaustive: never = sort;
      void _exhaustive;
      return query.order("registered_at", {
        ascending: false,
        nullsFirst: false,
      }) as Q;
    }
  }
}

// ─── dev seed 경로 (기존 그대로) ────────────────────────────

function listFromDevSeed(input: ListStudentsInput): ListStudentsResult {
  let rows = [...DEV_STUDENT_PROFILES];

  if (input.search) {
    const q = input.search.toLowerCase();
    const digits = phoneDigitsForSearch(input.search);
    rows = rows.filter((r) => {
      const name = r.name?.toLowerCase() ?? "";
      const school = r.school?.toLowerCase() ?? "";
      const phone = r.parent_phone ?? "";
      return (
        name.includes(q) ||
        school.includes(q) ||
        (digits ? phone.includes(digits) : phone.includes(input.search))
      );
    });
  }

  if (input.branch && input.branch !== "전체") {
    rows = rows.filter((r) => r.branch === input.branch);
  }

  if (input.grades.length > 0) {
    rows = rows.filter((r) => r.grade !== null && input.grades.includes(r.grade));
  }

  if (input.schoolLevels.length > 0) {
    rows = rows.filter(
      (r) =>
        r.school_level !== null && input.schoolLevels.includes(r.school_level),
    );
  }

  if (input.statuses.length > 0) {
    rows = rows.filter((r) => input.statuses.includes(r.status));
  }

  if (input.subjects.length > 0) {
    const wanted = [...new Set(input.subjects)];
    const hasSubject = (
      r: StudentProfileRow,
      subj: (typeof wanted)[number],
    ): boolean =>
      (r.subjects ?? []).includes(subj) ||
      DEV_ENROLLMENTS.some(
        (e) => e.student_id === r.id && e.subject === subj,
      );
    rows = rows.filter((r) =>
      input.subjectsMatchAll
        ? wanted.every((subj) => hasSubject(r, subj))
        : wanted.some((subj) => hasSubject(r, subj)),
    );
  }

  if (input.teachers.length > 0) {
    const wanted = new Set<string>(input.teachers);
    rows = rows.filter((r) => {
      const fromProfile = (r.teachers ?? []).some((t) => wanted.has(t));
      if (fromProfile) return true;
      return DEV_ENROLLMENTS.some(
        (e) =>
          e.student_id === r.id &&
          typeof e.teacher_name === "string" &&
          wanted.has(e.teacher_name),
      );
    });
  }

  if (input.schools.length > 0) {
    const wanted = new Set<string>(input.schools);
    rows = rows.filter((r) => r.school !== null && wanted.has(r.school));
  }

  if (input.unmappedSchool) {
    const ph = new Set<string>(UNMAPPED_SCHOOL_PATTERNS);
    rows = rows.filter(
      (r) => r.school === null || ph.has(r.school.trim()),
    );
  } else if (input.mappedSchool) {
    const ph = new Set<string>(UNMAPPED_SCHOOL_PATTERNS);
    rows = rows.filter(
      (r) => r.school !== null && !ph.has(r.school.trim()),
    );
  }

  if (input.regions.length > 0) {
    const wanted = new Set<string>(input.regions);
    rows = rows.filter((r) => wanted.has(r.region));
  }

  if (!input.includeHidden && input.grades.length === 0) {
    rows = rows.filter(
      (r) =>
        r.grade === null ||
        !HIDDEN_GRADES_BY_DEFAULT.includes(r.grade),
    );
  }

  rows = sortDevRows(rows, input.sort);

  const total = rows.length;
  const fromIdx = (input.page - 1) * input.pageSize;
  const paged = rows.slice(fromIdx, fromIdx + input.pageSize);

  return {
    rows: paged,
    total,
    page: input.page,
    pageSize: input.pageSize,
    source: "dev-seed",
  };
}

function sortDevRows(
  rows: StudentProfileRow[],
  sort: StudentSort,
): StudentProfileRow[] {
  const cmpRegisteredDesc = (
    a: StudentProfileRow,
    b: StudentProfileRow,
  ): number => {
    const av = a.registered_at;
    const bv = b.registered_at;
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return bv.localeCompare(av);
  };

  const cmpRegisteredAsc = (
    a: StudentProfileRow,
    b: StudentProfileRow,
  ): number => {
    const av = a.registered_at;
    const bv = b.registered_at;
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return av.localeCompare(bv);
  };

  const cmpNumber = (
    av: number | null,
    bv: number | null,
    asc: boolean,
  ): number => {
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return asc ? av - bv : bv - av;
  };

  const cmpString = (
    av: string | null,
    bv: string | null,
    asc: boolean,
  ): number => {
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return asc ? av.localeCompare(bv) : bv.localeCompare(av);
  };

  const sorted = [...rows];
  switch (sort) {
    case "registered_desc":
      sorted.sort(cmpRegisteredDesc);
      break;
    case "registered_asc":
      sorted.sort(cmpRegisteredAsc);
      break;
    case "name_asc":
      sorted.sort((a, b) => {
        const c = cmpString(a.name, b.name, true);
        return c !== 0 ? c : cmpRegisteredDesc(a, b);
      });
      break;
    case "name_desc":
      sorted.sort((a, b) => {
        const c = cmpString(a.name, b.name, false);
        return c !== 0 ? c : cmpRegisteredDesc(a, b);
      });
      break;
    case "enrollment_count_desc":
      sorted.sort((a, b) => {
        const c = cmpNumber(a.enrollment_count, b.enrollment_count, false);
        return c !== 0 ? c : cmpRegisteredDesc(a, b);
      });
      break;
    case "active_enrollment_count_desc":
      sorted.sort((a, b) => {
        const c = cmpNumber(
          a.active_enrollment_count,
          b.active_enrollment_count,
          false,
        );
        return c !== 0 ? c : cmpRegisteredDesc(a, b);
      });
      break;
    case "total_paid_desc":
      sorted.sort((a, b) => {
        const c = cmpNumber(a.total_paid, b.total_paid, false);
        return c !== 0 ? c : cmpRegisteredDesc(a, b);
      });
      break;
    default: {
      const _exhaustive: never = sort;
      void _exhaustive;
      sorted.sort(cmpRegisteredDesc);
    }
  }
  return sorted;
}
