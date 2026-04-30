import { createSupabaseServerClient } from "@/lib/supabase/server";
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

  let query = supabase.from("student_profiles").select("*", { count: "exact" });

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

  if (input.schoolLevels.length > 0) {
    query = query.in("school_level", input.schoolLevels);
  }

  if (input.tracks.length > 0) {
    query = query.in("track", input.tracks);
  }

  if (input.statuses.length > 0) {
    query = query.in("status", input.statuses);
  }

  // 수강 과목 필터 — student_profiles.subjects (text[]) 와 교집합.
  // .overlaps() 는 PostgreSQL && 연산자로 매핑.
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

  // 기본 숨김: includeHidden=false 이고 사용자가 학년 칩으로 명시적으로
  // 졸업·미정 을 선택하지 않은 경우에만 자동 숨김 적용.
  // 사용자가 grades 에 '졸업'/'미정' 을 포함시켰으면 그 의도를 존중.
  if (!input.includeHidden && input.grades.length === 0) {
    // PostgREST: grade NOT IN ('미정','졸업'). null grade 도 함께 보여주려면
    // .or("grade.is.null,grade.not.in.(미정,졸업)") 가 정확하지만,
    // 0012 마이그레이션 백필 후엔 grade 가 항상 9종 enum 중 하나이므로
    // 단순 NOT IN 으로 충분.
    query = query.not(
      "grade",
      "in",
      `(${HIDDEN_GRADES_BY_DEFAULT.join(",")})`,
    );
  }

  // ── 정렬 분기 ──────────────────────────────────────────────
  // NULLS 정책: 모든 정렬에서 NULL 은 항상 뒤(NULLS LAST). Supabase JS 의
  // `nullsFirst: false` 옵션이 SQL `NULLS LAST` 로 매핑됨.
  // 안정 정렬: 동률 시 registered_at DESC 를 보조 키로 추가.
  query = applySupabaseSort(query, input.sort);

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

/**
 * Supabase 쿼리에 정렬을 분기 적용한다.
 *
 * NULLS 정책: ASC/DESC 모두 NULL 은 항상 뒤(NULLS LAST). Supabase JS 의
 * `nullsFirst: false` 옵션이 SQL `NULLS LAST` 로 매핑되며, attendance_rate /
 * registered_at 처럼 NULL 가능 컬럼에서 빈 값을 위로 끌어올리지 않기 위함.
 *
 * 안정 정렬: 1차 키 동률 시 registered_at DESC 를 보조 키로 적용해
 * 동명이인·동일 출석률 학생의 순서를 일관되게 유지.
 *
 * 제네릭 제약은 우리가 호출하는 .order 시그니처만 노출하는 minimal 인터페이스
 * 로 좁혀, any 없이 호출부 빌더 타입을 보존한다.
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
  // 보조 키: 모든 분기에서 동일한 안정 정렬을 보장하기 위해
  // registered_at DESC, NULLS LAST 를 마지막에 한 번만 추가.
  const tieBreaker = (q: Q): Q =>
    q.order("registered_at", {
      ascending: false,
      nullsFirst: false,
    }) as Q;

  switch (sort) {
    case "registered_desc":
      // 최근 등록순 (기본값) — registered_at 단일 키.
      return query.order("registered_at", {
        ascending: false,
        nullsFirst: false,
      }) as Q;
    case "registered_asc":
      // 오래된 등록순.
      return query.order("registered_at", {
        ascending: true,
        nullsFirst: false,
      }) as Q;
    case "name_asc":
      // 이름 가나다순 (오름차순) + 등록일 내림차순 보조.
      return tieBreaker(
        query.order("name", { ascending: true }) as Q,
      );
    case "name_desc":
      // 이름 가나다 역순 + 등록일 내림차순 보조.
      return tieBreaker(
        query.order("name", { ascending: false }) as Q,
      );
    case "attendance_desc":
      // 출석률 높은 순 + 등록일 내림차순 보조.
      return tieBreaker(
        query.order("attendance_rate", {
          ascending: false,
          nullsFirst: false,
        }) as Q,
      );
    case "attendance_asc":
      // 출석률 낮은 순 + 등록일 내림차순 보조.
      return tieBreaker(
        query.order("attendance_rate", {
          ascending: true,
          nullsFirst: false,
        }) as Q,
      );
    case "enrollment_count_desc":
      // 수강 강좌 수 많은 순 + 등록일 내림차순 보조.
      return tieBreaker(
        query.order("enrollment_count", {
          ascending: false,
          nullsFirst: false,
        }) as Q,
      );
    case "total_paid_desc":
      // 누적 결제 금액 많은 순 + 등록일 내림차순 보조.
      return tieBreaker(
        query.order("total_paid", {
          ascending: false,
          nullsFirst: false,
        }) as Q,
      );
    default: {
      // 미래 enum 추가 시 컴파일 타임 누락 방지.
      const _exhaustive: never = sort;
      void _exhaustive;
      return query.order("registered_at", {
        ascending: false,
        nullsFirst: false,
      }) as Q;
    }
  }
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

  if (input.schoolLevels.length > 0) {
    rows = rows.filter(
      (r) =>
        r.school_level !== null && input.schoolLevels.includes(r.school_level),
    );
  }

  if (input.tracks.length > 0) {
    rows = rows.filter(
      (r) => r.track !== null && input.tracks.includes(r.track),
    );
  }

  if (input.statuses.length > 0) {
    rows = rows.filter((r) => input.statuses.includes(r.status));
  }

  // 수강 과목 필터 — student_profiles.subjects 에는 view 단에서 enrollments
  // 의 subject 가 집계되어 있다. dev seed 시드도 동일 형태(text[])로 채워져
  // 있으나 일부 학생은 null 이므로 enrollments fallback 도 함께 적용.
  if (input.subjects.length > 0) {
    const wanted = new Set<string>(input.subjects);
    rows = rows.filter((r) => {
      const fromProfile = (r.subjects ?? []).some((s) => wanted.has(s));
      if (fromProfile) return true;
      // profile.subjects 가 비어있어도 enrollments 에서 일치하면 통과.
      return DEV_ENROLLMENTS.some(
        (e) =>
          e.student_id === r.id &&
          typeof e.subject === "string" &&
          wanted.has(e.subject),
      );
    });
  }

  // 강사명 필터 — profile.teachers 가 우선, 없으면 enrollments.teacher_name
  // fallback 으로 매칭.
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

  // 학교 필터 — students.school 정확 일치.
  if (input.schools.length > 0) {
    const wanted = new Set<string>(input.schools);
    rows = rows.filter((r) => r.school !== null && wanted.has(r.school));
  }

  // 기본 숨김 (Supabase 경로와 동일 규칙).
  if (!input.includeHidden && input.grades.length === 0) {
    rows = rows.filter(
      (r) =>
        r.grade === null ||
        !HIDDEN_GRADES_BY_DEFAULT.includes(r.grade),
    );
  }

  // ── 정렬 분기 ──────────────────────────────────────────────
  // Supabase 경로와 동일 시맨틱: NULL 은 항상 뒤, 동률 시 registered_at DESC
  // 보조 키.
  rows = sortDevRows(rows, input.sort);

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

/**
 * dev seed rows 정렬 — Supabase 경로의 NULLS LAST + registered_at DESC 보조 키
 * 시맨틱을 그대로 흉내낸다. UI 동작 확인용이므로 단순 비교로 구현.
 */
function sortDevRows(
  rows: StudentProfileRow[],
  sort: StudentSort,
): StudentProfileRow[] {
  // 등록일 DESC (NULL 은 뒤). 보조 키와 registered_desc 본 키 양쪽에 사용.
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

  // 등록일 ASC (NULL 은 뒤).
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

  // 숫자 필드 비교 (NULL 은 뒤).
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

  // 문자열 비교 (NULL 은 뒤).
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
      // 미래 enum 추가 시 컴파일 타임 누락 방지.
      const _exhaustive: never = sort;
      void _exhaustive;
      sorted.sort(cmpRegisteredDesc);
    }
  }
  return sorted;
}
