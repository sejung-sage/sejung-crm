import { unstable_cache } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  DEV_SCHOOL_REGIONS,
  DEV_STUDENT_PROFILES,
  isDevSeedMode,
} from "./students-dev-seed";
import { HIDDEN_GRADES_BY_DEFAULT } from "@/lib/schemas/common";
import type { ListStudentsInput } from "@/lib/schemas/student";
import type { Grade, SchoolLevel } from "@/types/database";

const CACHE_SECONDS = 300;

/**
 * 학생 리스트 필터의 학교 옵션을 prefetch 한다.
 *
 * 사용처: `/students` Server Component 가 호출 → 결과를 `StudentsFilters` 에
 * `schoolGroups` prop 으로 전달.
 *
 * 출력 구조 (2026-05-15):
 *  - 학교를 5개 지역 그룹으로 묶어 반환. UI 는 펼치기 토글 패널 안에
 *    그룹별 칩으로 노출한다.
 *  - 매핑(school_regions) 에 없거나 5종 외 지역이면 '기타' 그룹으로.
 *  - `schools` 평탄 배열은 호환 유지(콤보박스 등 다른 잠재 소비처 대비).
 *
 * 좁힘 정책 (2026-05-20):
 *  학교 옵션은 학생 명단 결과와 일치하도록 동일 필터를 적용해 distinct school 만
 *  노출. branch + grade + schoolLevel + status + includeHidden 적용.
 *  region 은 예외 — 그 필터로 학교 옵션을 좁히면 region 칩 해제 전엔 다른 지역
 *  학교를 검색해도 못 찾는 UX 함정이 생긴다 (region 칩은 학교 그룹 분류 자체에
 *  사용되므로 칩 클릭 시 자동으로 패널이 reorder 됨).
 *  schools 도 적용 안 함 (선택한 학교만 남으면 다른 학교 추가 못 함).
 *
 * 성능:
 *  - students 테이블에서 school 컬럼만 직접 조회 (무거운 student_profiles 뷰 회피).
 *  - service client. 필터가 많은 조합이라 unstable_cache 효과 작음 → 매번 페치.
 *  - 0046 인덱스(branch+status+school_level+grade) 활용해 distinct 1초 이내.
 *  - school_regions 매핑은 한 번 조회 (매핑 수 수십~수백 행, 가벼움).
 */

const PAGE_SIZE = 1000;
const MAX_PAGES = 10; // 안전상한 — 1만 행까지. branch 필터 적용 시 충분.

// 지역 옵션 SSOT 사용 — UI 칩과 동일 순서/내용 보장.
import {
  REGION_OPTIONS,
  type RegionOption,
  isKnownRegion,
} from "@/config/regions";

/** @deprecated REGION_OPTIONS 를 직접 import 하세요. 호환 유지용 alias. */
export const SCHOOL_REGION_BUCKETS = REGION_OPTIONS;
/** @deprecated RegionOption 을 직접 import 하세요. 호환 유지용 alias. */
export type SchoolRegionBucket = RegionOption;

export interface SchoolGroup {
  region: RegionOption;
  schools: string[];
}

export interface StudentFilterOptions {
  /** 강사명 — 학생 명단에서는 사용 안 함. 그룹 빌더 전용. 항상 빈 배열. */
  teachers: string[];
  /** 학교명 평탄 배열 (오름차순). 호환 유지용. */
  schools: string[];
  /** 학교를 5개 지역 그룹으로 묶은 결과. UI 칩 패널의 단일 소스. */
  schoolGroups: SchoolGroup[];
  /** 현재 필터 조합에 매칭되는 학생을 가진 학년 set (UI 학년 칩 가시화용). */
  availableGrades: Grade[];
  /** 매칭 학생을 가진 학교급 set (UI 학교급 세그먼트 가시화용). */
  availableSchoolLevels: SchoolLevel[];
  /** 매칭 학생을 가진 지역 set (UI 지역 칩 가시화용). */
  availableRegions: RegionOption[];
}

/**
 * 학교 옵션 좁힘에 사용할 필터 셋.
 * ListStudentsInput 전체가 아니라 학교 옵션과 의미 있는 필드만 명시.
 * region/schools 는 의도적으로 제외 — 자기 자신을 좁히는 모순 회피.
 */
export interface StudentFilterOptionsInput {
  branch?: string;
  grades?: ListStudentsInput["grades"];
  schoolLevels?: ListStudentsInput["schoolLevels"];
  statuses?: ListStudentsInput["statuses"];
  includeHidden?: boolean;
}

export async function listStudentFilterOptions(
  input: StudentFilterOptionsInput | string | undefined,
): Promise<StudentFilterOptions> {
  // 호환: 옛 호출부가 branch 문자열만 넘기는 케이스도 지원.
  const normalized: StudentFilterOptionsInput =
    typeof input === "string" || input === undefined
      ? { branch: input }
      : input;
  if (isDevSeedMode()) {
    return collectFromDevSeed(normalized);
  }
  // 필터 조합을 캐시 키로 직렬화 — 같은 조합 재접근 시 hit.
  const cacheKey = JSON.stringify({
    b: normalized.branch ?? "__all__",
    g: normalized.grades ?? [],
    l: normalized.schoolLevels ?? [],
    s: normalized.statuses ?? [],
    h: normalized.includeHidden ?? false,
  });
  return cachedCollectFromSupabase(cacheKey, normalized);
}

async function collectFromSupabase(
  input: StudentFilterOptionsInput,
): Promise<StudentFilterOptions> {
  // service client — 쿠키 의존 없음 + unstable_cache 호환.
  const supabase = createSupabaseServiceClient();

  // 1) 학생 테이블에서 학교명 distinct (1만 행 cap 페이지네이션).
  //    학생 명단의 list-students 와 동일 필터 적용 — region/schools 만 제외.
  const schoolSet = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from("crm_students")
      .select("school")
      .not("school", "is", null)
      .neq("status", "탈퇴") // 안전 정책상 탈퇴 학생 학교는 옵션에서 제외.
      .range(from, to);

    if (input.branch && input.branch !== "전체") {
      query = query.eq("branch", input.branch);
    }
    if (input.grades && input.grades.length > 0) {
      query = query.in("grade", input.grades);
    }
    if (input.schoolLevels && input.schoolLevels.length > 0) {
      query = query.in("school_level", input.schoolLevels);
    }
    if (input.statuses && input.statuses.length > 0) {
      query = query.in("status", input.statuses);
    }
    if (
      input.includeHidden !== true &&
      (!input.grades || input.grades.length === 0)
    ) {
      query = query.not(
        "grade",
        "in",
        `(${HIDDEN_GRADES_BY_DEFAULT.join(",")})`,
      );
    }

    const { data, error } = await query;
    if (error) {
      return { teachers: [], schools: [], schoolGroups: emptyGroups() };
    }

    const rows = (data ?? []) as unknown as { school: string | null }[];
    if (rows.length === 0) break;

    for (const row of rows) {
      if (typeof row.school === "string" && row.school.trim().length > 0) {
        schoolSet.add(row.school.trim());
      }
    }

    if (rows.length < PAGE_SIZE) break;
  }

  // 2) school_regions 매핑 전체 조회 (수십~수백 행, 가벼움).
  const { data: mappingRows } = await supabase
    .from("crm_school_regions")
    .select("school, region");
  const schoolToRegion = new Map<string, string>();
  for (const m of (mappingRows ?? []) as { school: string; region: string }[]) {
    if (typeof m.school === "string" && typeof m.region === "string") {
      schoolToRegion.set(m.school.trim(), m.region.trim());
    }
  }

  return buildOptions(schoolSet, schoolToRegion);
}

// cacheKey 를 첫 인자로 받아 unstable_cache 가 키로 인식. input 은 본문에서 사용.
const cachedCollectFromSupabase = unstable_cache(
  async (
    _cacheKey: string,
    input: StudentFilterOptionsInput,
  ): Promise<StudentFilterOptions> => collectFromSupabase(input),
  ["student-school-options-v2"],
  { revalidate: CACHE_SECONDS, tags: ["student-school-options"] },
);

function collectFromDevSeed(
  input: StudentFilterOptionsInput,
): StudentFilterOptions {
  const schoolSet = new Set<string>();
  const filtered = DEV_STUDENT_PROFILES.filter((r) => {
    if (r.status === "탈퇴") return false;
    if (input.branch && input.branch !== "전체" && r.branch !== input.branch) {
      return false;
    }
    if (input.grades && input.grades.length > 0) {
      if (!r.grade || !input.grades.includes(r.grade)) return false;
    }
    if (input.schoolLevels && input.schoolLevels.length > 0) {
      if (!r.school_level || !input.schoolLevels.includes(r.school_level)) {
        return false;
      }
    }
    if (input.statuses && input.statuses.length > 0) {
      if (!input.statuses.includes(r.status)) return false;
    }
    if (
      input.includeHidden !== true &&
      (!input.grades || input.grades.length === 0)
    ) {
      if (r.grade && HIDDEN_GRADES_BY_DEFAULT.includes(r.grade)) return false;
    }
    return true;
  });

  for (const r of filtered) {
    if (typeof r.school === "string" && r.school.trim().length > 0) {
      schoolSet.add(r.school.trim());
    }
  }

  const schoolToRegion = new Map<string, string>();
  for (const m of DEV_SCHOOL_REGIONS) {
    schoolToRegion.set(m.school.trim(), m.region.trim());
  }

  return buildOptions(schoolSet, schoolToRegion);
}

/**
 * 학교 set + 매핑 map → 평탄 배열 + 그룹 배열.
 * Supabase / dev seed 양쪽 동일 형태로 가공.
 */
function buildOptions(
  schoolSet: Set<string>,
  schoolToRegion: Map<string, string>,
): StudentFilterOptions {
  const buckets = new Map<RegionOption, Set<string>>();
  for (const b of SCHOOL_REGION_BUCKETS) buckets.set(b, new Set());

  for (const school of schoolSet) {
    const mapped = schoolToRegion.get(school);
    const bucket: RegionOption =
      mapped && isKnownBucket(mapped) ? mapped : "기타";
    buckets.get(bucket)!.add(school);
  }

  const schoolGroups: SchoolGroup[] = SCHOOL_REGION_BUCKETS.map((region) => ({
    region,
    schools: [...buckets.get(region)!].sort((a, b) => a.localeCompare(b, "ko")),
  }));

  return {
    teachers: [],
    schools: [...schoolSet].sort((a, b) => a.localeCompare(b, "ko")),
    schoolGroups,
  };
}

function isKnownBucket(v: string): v is RegionOption {
  return isKnownRegion(v);
}

function emptyGroups(): SchoolGroup[] {
  return SCHOOL_REGION_BUCKETS.map((region) => ({ region, schools: [] }));
}
