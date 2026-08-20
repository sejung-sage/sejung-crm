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
 * 성능 (0122):
 *  - distinct 를 SQL 로 내림 — `list_student_filter_options` RPC 1회 호출.
 *  - students 테이블 베이스 (무거운 student_profiles 뷰 회피).
 *  - service client. 필터가 많은 조합이라 unstable_cache 효과 작음 → 매번 페치.
 *  - 0046 인덱스(branch+status+school_level+grade) 활용.
 *  - school_regions 매핑은 한 번 조회 (매핑 수 수십~수백 행, 가벼움).
 *
 *  ※ 이전 구현은 1,000행씩 최대 10페이지(=상위 10,000행)만 훑어 distinct 를
 *    앱 메모리에서 모았다. 대치(탈퇴 제외 65,570명) 기준 실제 학교 2,393개 중
 *    999개만 노출되고, ORDER BY 가 없어 새로고침마다 목록이 바뀌었다
 *    (2026-08-20 현장 제보 "발송 대상을 찾지를 못한다"). 상한 자체를 없앤다.
 */

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

  // 1) 학생 distinct (school, grade, school_level) — RPC 1회 (0122).
  //    학생 명단의 list-students 와 정합. region/schools 만 제외.
  //
  //    학년 칩의 옵션을 구할 때 grades 필터 자체가 들어가면 자기 자신 좁힘 →
  //    옵션 셋 산정 시 grades 는 제외. school_level/region 도 동일 이유로 본 함수가
  //    자기 자신을 좁힘 회피 — 다만 학교 옵션의 필터 정책(자기 외 모두 적용)을
  //    그대로 가져가서 학년/지역 옵션도 같은 정책 사용.
  //
  //    숨김 학년은 상수를 그대로 넘긴다 — SQL 에 '졸업','미정' 을 또 박지 않고
  //    HIDDEN_GRADES_BY_DEFAULT 를 단일 소스로 유지하기 위함.
  const rpcResult = await (
    supabase.rpc as unknown as (
      fn: "list_student_filter_options",
      params: {
        p_branch: string | null;
        p_statuses: string[] | null;
        p_hidden_grades: string[] | null;
      },
    ) => Promise<{
      data: Array<{
        schools: string[] | null;
        grades: string[] | null;
        school_levels: string[] | null;
      }> | null;
      error: { message: string } | null;
    }>
  )("list_student_filter_options", {
    p_branch:
      input.branch && input.branch !== "전체" ? input.branch : null,
    p_statuses:
      input.statuses && input.statuses.length > 0 ? [...input.statuses] : null,
    p_hidden_grades:
      input.includeHidden === true ? null : [...HIDDEN_GRADES_BY_DEFAULT],
  });

  if (rpcResult.error) {
    return {
      teachers: [],
      schools: [],
      schoolGroups: emptyGroups(),
      availableGrades: [],
      availableSchoolLevels: [],
      availableRegions: [],
    };
  }

  const row = rpcResult.data?.[0];
  const schoolSet = new Set<string>(
    (row?.schools ?? [])
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
  const gradeSet = new Set<Grade>((row?.grades ?? []) as Grade[]);
  const levelSet = new Set<SchoolLevel>(
    (row?.school_levels ?? []) as SchoolLevel[],
  );

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
