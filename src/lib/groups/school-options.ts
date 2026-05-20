/**
 * F2-02 · 학교 토글 칩 후보 리스트.
 *
 * - dev-seed: DEV_STUDENT_PROFILES 의 고유 school 값
 * - Supabase: crm_students 에서 distinct school 추출. 풀 집계 뷰 우회.
 *
 * 캐시 정책:
 *   - 학교명 변동은 ETL 동기화 후에만 발생 (운영 중 즉시 추가는 거의 없음).
 *   - service client + unstable_cache(300s) 로 분원 전역 키 공유.
 *   - 그룹 빌더 진입마다 풀 집계 발생하던 비용을 캐시 hit 으로 흡수.
 */

import { unstable_cache } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  DEV_STUDENT_PROFILES,
  isDevSeedMode,
} from "@/lib/profile/students-dev-seed";

export async function getSchoolOptions(): Promise<string[]> {
  if (isDevSeedMode()) {
    return uniqueSortedSchools(
      DEV_STUDENT_PROFILES.map((p) => p.school).filter(
        (s): s is string => typeof s === "string" && s.length > 0,
      ),
    );
  }

  return cachedSchoolOptionsFromSupabase();
}

const cachedSchoolOptionsFromSupabase = unstable_cache(
  async () => {
    // service client — 쿠키 의존 없음. unstable_cache 와 호환.
    // crm_students 인덱스(0046 status, school) 활용 → 풀 집계 없음.
    const supabase = createSupabaseServiceClient();
    const { data, error } = await supabase
      .from("crm_students")
      .select("school")
      .not("school", "is", null)
      .neq("status", "탈퇴")
      .limit(20000); // 학생 6만 규모에서 학교 distinct 안전 상한

    if (error) {
      return [] as string[];
    }
    const schools = ((data ?? []) as Array<{ school: string | null }>)
      .map((r) => r.school)
      .filter((s): s is string => typeof s === "string" && s.length > 0);
    return uniqueSortedSchools(schools);
  },
  ["group-builder-school-options-v2"],
  {
    revalidate: 300,
    tags: ["school-options"],
  },
);

function uniqueSortedSchools(schools: string[]): string[] {
  const set = new Set<string>();
  for (const s of schools) set.add(s);
  return Array.from(set).sort((a, b) => a.localeCompare(b, "ko-KR"));
}
