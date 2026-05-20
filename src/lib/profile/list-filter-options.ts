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

  // 1) 학생 distinct (school, grade, school_level) — 동일 필터 적용.
  //    학생 명단의 list-students 와 정합. region/schools 만 제외.
  //
  //    학년 칩의 옵션을 구할 때 grades 필터 자체가 들어가면 자기 자신 좁힘 →
  //    옵션 셋 산정 시 grades 는 제외. school_level/region 도 동일 이유로 본 함수가
  //    자기 자신을 좁힘 회피 — 다만 학교 옵션의 필터 정책(자기 외 모두 적용)을
  //    그대로 가져가서 학년/지역 옵션도 같은 정책 사용.
  const schoolSet = new Set<string>();
  const gradeSet = new Set<Grade>();
  const levelSet = new Set<SchoolLevel>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from("crm_students")
      .select("school, grade, school_level")
      .neq("status", "탈퇴")
      .range(from, to);

    if (input.branch && input.branch !== "전체") {
      query = query.eq("branch", input.branch);
    }
    if (input.statuses && input.statuses.length > 0) {
      query = query.in("status", input.statuses);
    }
    // 학년/학교급/지역 필터 자체는 옵션을 좁히는 데 쓰지 않음 (자기 자신 좁힘 방지).
    // includeHidden 만 적용 — 졸업/미정 학생 학교/지역도 함께 숨김.
    if (input.includeHidden !== true) {
      query = query.not(
        "grade",
        "in",
        `(${HIDDEN_GRADES_BY_DEFAULT.join(",")})`,
      );
    }

    const { data, error } = await query;
    if (error) {
      return {
        teachers: [],
        schools: [],
        schoolGroups: emptyGroups(),
        availableGrades: [],
        availableSchoolLevels: [],
        availableRegions: [],
      };
    }

    const rows = (data ?? []) as unknown as Array<{
      school: string | null;
      grade: Grade | null;
      school_level: SchoolLevel | null;
    }>;
    if (rows.length === 0) break;

    for (const row of rows) {
      if (typeof row.school === "string" && row.school.trim().length > 0) {
        schoolSet.add(row.school.trim());
      }
      if (row.grade) gradeSet.add(row.grade);
      if (row.school_level) levelSet.add(row.school_level);
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

  return buildOptions(schoolSet, schoolToRegion, gradeSet, levelSet);
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
  const gradeSet = new Set<Grade>();
  const levelSet = new Set<SchoolLevel>();

  // Supabase 분기와 동일 정책: 옵션 자기 자신을 좁히는 grades/schoolLevels 는 미적용.
  const filtered = DEV_STUDENT_PROFILES.filter((r) => {
    if (r.status === "탈퇴") return false;
    if (input.branch && input.branch !== "전체" && r.branch !== input.branch) {
      return false;
    }
    if (input.statuses && input.statuses.length > 0) {
      if (!input.statuses.includes(r.status)) return false;
    }
    if (input.includeHidden !== true) {
      if (r.grade && HIDDEN_GRADES_BY_DEFAULT.includes(r.grade)) return false;
    }
    return true;
  });

  for (const r of filtered) {
    if (typeof r.school === "string" && r.school.trim().length > 0) {
      schoolSet.add(r.school.trim());
    }
    if (r.grade) gradeSet.add(r.grade);
    if (r.school_level) levelSet.add(r.school_level);
  }

  const schoolToRegion = new Map<string, string>();
  for (const m of DEV_SCHOOL_REGIONS) {
    schoolToRegion.set(m.school.trim(), m.region.trim());
  }

  return buildOptions(schoolSet, schoolToRegion, gradeSet, levelSet);
}

/**
 * 학교 set + 매핑 map + grade/level set → 평탄 배열 + 그룹 배열 + 가용 옵션 set.
 * Supabase / dev seed 양쪽 동일 형태로 가공.
 */
function buildOptions(
  schoolSet: Set<string>,
  schoolToRegion: Map<string, string>,
  gradeSet: Set<Grade>,
  levelSet: Set<SchoolLevel>,
): StudentFilterOptions {
  const buckets = new Map<RegionOption, Set<string>>();
  for (const b of SCHOOL_REGION_BUCKETS) buckets.set(b, new Set());

  // 지역별 학교 분배 + region availability 계산.
  const availableRegionSet = new Set<RegionOption>();
  for (const school of schoolSet) {
    const mapped = schoolToRegion.get(school);
    const bucket: RegionOption =
      mapped && isKnownBucket(mapped) ? mapped : "기타";
    buckets.get(bucket)!.add(school);
    availableRegionSet.add(bucket);
  }

  const schoolGroups: SchoolGroup[] = SCHOOL_REGION_BUCKETS.map((region) => ({
    region,
    schools: [...buckets.get(region)!].sort((a, b) => a.localeCompare(b, "ko")),
  }));

  // 학년·학교급은 SSOT 순서대로 (UI 칩 순서와 일치). available 셋과 교집합.
  const GRADE_ORDER: Grade[] = [
    "초등",
    "중1",
    "중2",
    "중3",
    "고1",
    "고2",
    "고3",
    "재수",
    "졸업",
    "미정",
  ];
  const LEVEL_ORDER: SchoolLevel[] = ["초", "중", "고", "기타"];

  return {
    teachers: [],
    schools: [...schoolSet].sort((a, b) => a.localeCompare(b, "ko")),
    schoolGroups,
    availableGrades: GRADE_ORDER.filter((g) => gradeSet.has(g)),
    availableSchoolLevels: LEVEL_ORDER.filter((l) => levelSet.has(l)),
    availableRegions: SCHOOL_REGION_BUCKETS.filter((r) =>
      availableRegionSet.has(r),
    ),
  };
}

function isKnownBucket(v: string): v is RegionOption {
  return isKnownRegion(v);
}

function emptyGroups(): SchoolGroup[] {
  return SCHOOL_REGION_BUCKETS.map((region) => ({ region, schools: [] }));
}
