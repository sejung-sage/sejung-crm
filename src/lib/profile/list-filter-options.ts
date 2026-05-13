import { unstable_cache } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { DEV_STUDENT_PROFILES, isDevSeedMode } from "./students-dev-seed";

/**
 * 학생 리스트 필터의 학교 옵션을 prefetch 한다.
 *
 * 사용처: `/students` Server Component 가 호출 → 결과를 `StudentsFilters` 에
 * `schoolOptions` prop 으로 전달. (강사 옵션은 학생 명단에서 제거 — 그룹 빌더 전용.)
 *
 * 성능 핫픽스 (2026-05-13):
 *  - 기존: student_profiles 뷰에서 teachers/school 컬럼을 최대 1만 행 페이지네이션.
 *    뷰가 LEFT JOIN enrollments + attendances + COUNT(DISTINCT) 카테시안이라
 *    매 페이지 로드마다 Supabase statement_timeout(기본 8s) 을 초과해 `/students`
 *    가 통째로 깨졌음.
 *  - 변경: 학교 옵션만 필요하므로 students 테이블에서 school 컬럼만 직접 조회.
 *    뷰의 JOIN/집계 비용 없음. 또한 service client 로 호출하여 RLS 우회 →
 *    `unstable_cache` 로 60초 캐시 (branch 별 키). 학교가 추가/삭제되어도
 *    UI 반영은 최대 60초 지연.
 *  - branch 필터는 코드에서 직접 적용하므로 RLS 우회의 의미 노출 없음.
 *
 * dev-seed 모드에서는 인메모리 시드에서 학교만 수집.
 */

const PAGE_SIZE = 1000;
const MAX_PAGES = 10; // 안전상한 — 1만 행까지. branch 필터 적용 시 충분.
const CACHE_SECONDS = 60;

export interface StudentFilterOptions {
  /** 강사명 — 학생 명단에서는 사용 안 함. 그룹 빌더 전용. 항상 빈 배열. */
  teachers: string[];
  /** 학교명 (오름차순). 빈 문자열·null 제외. */
  schools: string[];
}

export async function listStudentFilterOptions(
  branch: string | undefined,
): Promise<StudentFilterOptions> {
  if (isDevSeedMode()) {
    return collectFromDevSeed(branch);
  }
  // unstable_cache 키에 undefined 가 들어가면 안 되어서 sentinel 변환.
  return cachedCollectFromSupabase(branch ?? "__all__");
}

async function collectFromSupabase(
  branch: string | undefined,
): Promise<StudentFilterOptions> {
  // service client — 쿠키 의존 없음. unstable_cache 와 호환.
  // students.school 만 노출하므로 RLS 우회 영향 없음 (이미 학생 명단에 표출되는 정보).
  const supabase = createSupabaseServiceClient();

  const schoolSet = new Set<string>();

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from("students")
      .select("school")
      .not("school", "is", null)
      .range(from, to);

    if (branch && branch !== "전체") {
      query = query.eq("branch", branch);
    }

    const { data, error } = await query;
    if (error) {
      // 옵션 prefetch 실패는 페이지를 깨면 안 된다 — 빈 옵션 fallback.
      return { teachers: [], schools: [] };
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

  return {
    teachers: [],
    schools: [...schoolSet].sort((a, b) => a.localeCompare(b)),
  };
}

const cachedCollectFromSupabase = unstable_cache(
  async (branchKey: string): Promise<StudentFilterOptions> => {
    const branch = branchKey === "__all__" ? undefined : branchKey;
    return collectFromSupabase(branch);
  },
  ["student-school-options"],
  { revalidate: CACHE_SECONDS, tags: ["student-school-options"] },
);

function collectFromDevSeed(
  branch: string | undefined,
): StudentFilterOptions {
  const schoolSet = new Set<string>();

  const profiles =
    branch && branch !== "전체"
      ? DEV_STUDENT_PROFILES.filter((r) => r.branch === branch)
      : DEV_STUDENT_PROFILES;

  for (const r of profiles) {
    if (typeof r.school === "string" && r.school.trim().length > 0) {
      schoolSet.add(r.school.trim());
    }
  }

  return {
    teachers: [],
    schools: [...schoolSet].sort((a, b) => a.localeCompare(b)),
  };
}
