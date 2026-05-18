import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import type { StudentProfileRow } from "@/types/database";
import type { ListStudentsInput, StudentSort } from "@/lib/schemas/student";
import { HIDDEN_GRADES_BY_DEFAULT } from "@/lib/schemas/common";
import {
  DEV_ENROLLMENTS,
  DEV_STUDENT_PROFILES,
  isDevSeedMode,
} from "./students-dev-seed";

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

  // ─── region 필터 → 학교 list 변환 ──────────────────────────
  // count 쿼리는 students 베이스라 sr.region 컬럼이 없다. school_regions 를
  // 한 번 조회해서 student.school IN (...) 형태로 변환.
  const regionPlan = await resolveRegionToSchools(input.regions);

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
    .from("students")
    .select("id", { count: "exact", head: true });

  if (input.search) {
    const like = `%${input.search}%`;
    countQuery = countQuery.or(
      `name.ilike.${like},school.ilike.${like},parent_phone.ilike.${like}`,
    );
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

  // ─── 본 select (student_profiles 뷰) ──────────────────────
  let query = supabase.from("student_profiles").select("*");

  if (input.search) {
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

  // 지역 필터 — student_profiles.region (school_regions 매핑) 정확 일치.
  // 미매칭/학교 NULL 학생은 뷰에서 '기타' 로 fallback 되므로 사용자가 '기타'
  // 칩을 켜면 그 학생들이 함께 잡힌다. 0026 추가.
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

  // count·data 병렬 실행.
  const [countResult, dataResult] = await Promise.all([
    countQuery,
    query.range(from, to),
  ]);

  if (dataResult.error) {
    throw new Error(`학생 목록 조회에 실패했습니다: ${dataResult.error.message}`);
  }

  // count 쿼리가 실패해도 본 select 가 성공했으면 페이지는 살린다 (총 수 0 fallback).
  const total = countResult.error ? 0 : (countResult.count ?? 0);

  return {
    rows: (dataResult.data ?? []) as StudentProfileRow[],
    total,
    page: input.page,
    pageSize: input.pageSize,
    source: "supabase",
  };
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

  // service client — school_regions 조회 (RLS 없음, 학교명/지역만).
  const serviceSupabase = createSupabaseServiceClient();

  const includeEtc = regions.includes("기타");
  const knownRegions = regions.filter((r) => r !== "기타");

  let explicitSchools: string[] = [];
  if (knownRegions.length > 0) {
    const { data } = await serviceSupabase
      .from("school_regions")
      .select("school")
      .in("region", knownRegions);
    explicitSchools = ((data ?? []) as Array<{ school: string }>).map(
      (r) => r.school,
    );
  }

  let allMappedSchools: string[] = [];
  if (includeEtc) {
    const { data } = await serviceSupabase
      .from("school_regions")
      .select("school");
    allMappedSchools = ((data ?? []) as Array<{ school: string }>).map(
      (r) => r.school,
    );
  }

  return { explicitSchools, includeEtc, allMappedSchools };
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
    case "attendance_desc":
      return tieBreaker(
        query.order("attendance_rate", {
          ascending: false,
          nullsFirst: false,
        }) as Q,
      );
    case "attendance_asc":
      return tieBreaker(
        query.order("attendance_rate", {
          ascending: true,
          nullsFirst: false,
        }) as Q,
      );
    case "enrollment_count_desc":
      return tieBreaker(
        query.order("enrollment_count", {
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
    const wanted = new Set<string>(input.subjects);
    rows = rows.filter((r) => {
      const fromProfile = (r.subjects ?? []).some((s) => wanted.has(s));
      if (fromProfile) return true;
      return DEV_ENROLLMENTS.some(
        (e) =>
          e.student_id === r.id &&
          typeof e.subject === "string" &&
          wanted.has(e.subject),
      );
    });
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
    case "attendance_desc":
      sorted.sort((a, b) => {
        const c = cmpNumber(a.attendance_rate, b.attendance_rate, false);
        return c !== 0 ? c : cmpRegisteredDesc(a, b);
      });
      break;
    case "attendance_asc":
      sorted.sort((a, b) => {
        const c = cmpNumber(a.attendance_rate, b.attendance_rate, true);
        return c !== 0 ? c : cmpRegisteredDesc(a, b);
      });
      break;
    case "enrollment_count_desc":
      sorted.sort((a, b) => {
        const c = cmpNumber(a.enrollment_count, b.enrollment_count, false);
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
