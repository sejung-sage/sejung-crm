/**
 * F2-02 · 학교 토글 칩 후보 리스트.
 *
 * - dev-seed: DEV_STUDENT_PROFILES 의 고유 school 값
 * - Supabase: student_profiles 에서 최근 등록순으로 상위 100개 추출 후 unique
 *
 * 대량(수백 개)이어도 상위 8개만 기본 노출 + "더보기" 처리는 UI 쪽 책임.
 * 여기서는 단순 정렬된 문자열 배열을 반환.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
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

  const supabase = await createSupabaseServerClient();
  // 전체 분원 합산 리스트. 분원별로 나누지 않는 이유:
  //  - UI 에서 분원을 바꿔도 곧바로 학교 후보가 달라지면 사용자가 혼란스러움.
  //  - 유효하지 않은 조합(다른 분원 학교 선택)은 카운트 결과 0 명으로 자연스럽게 드러남.
  const { data, error } = await supabase
    .from("student_profiles")
    .select("school")
    .not("school", "is", null)
    .neq("status", "탈퇴")
    .limit(500);

  if (error) {
    // 후보 로드 실패해도 빌더는 기본 동작해야 하므로 빈 배열.
    return [];
  }

  const schools = ((data ?? []) as Array<{ school: string | null }>)
    .map((r) => r.school)
    .filter((s): s is string => typeof s === "string" && s.length > 0);

  return uniqueSortedSchools(schools);
}

function uniqueSortedSchools(schools: string[]): string[] {
  const set = new Set<string>();
  for (const s of schools) set.add(s);
  return Array.from(set).sort((a, b) => a.localeCompare(b, "ko-KR"));
}
