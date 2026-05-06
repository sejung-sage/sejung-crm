/**
 * 매핑 누락 학교 리스트.
 *
 * "students 에 있지만 school_regions 에는 없는" 학교를 학생 수 내림차순으로
 * 반환. admin "지역 매핑" UI 의 미매핑 섹션 핵심 데이터 — 클릭 한 번에 매핑
 * 후보를 빠르게 처리할 수 있도록 한다.
 *
 * 매칭 정책 (0026 student_profiles 뷰와 동일):
 *   - 학생의 region == '기타' 그룹화. 뷰가 LEFT JOIN + COALESCE('기타') 이므로
 *     "매핑 없음" 과 "school IS NULL" 양쪽이 모두 region='기타' 로 떨어진다.
 *   - 단, 학교명 NULL/빈 학생은 "매핑 대상" 이 아니므로 결과에서 제외 (학교가
 *     null 인 학생은 어차피 매핑할 키가 없음).
 *
 * 정렬: student_count DESC. cap 50 (한 번에 처리할 양).
 *
 * 구현 노트:
 *   - student_profiles 뷰를 region='기타' 로 필터 + school NOT NULL 로 select
 *     후 JS 단에서 학교별 카운트 집계. 6만 학생 중 '기타' 만 좁히면 보통
 *     수백~수천 행이라 cap 1000 안에 들어감.
 *   - 풀스캔이 부담되면 향후 RPC 함수 (`list_missing_school_regions()`) 로
 *     이전 권장. MVP 는 단순 select 로 처리.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  DEV_SCHOOL_REGIONS,
  DEV_STUDENT_PROFILES,
  isDevSeedMode,
} from "@/lib/profile/students-dev-seed";

const TOP_LIMIT = 50;
/**
 * student_profiles 에서 region='기타' 학생 학교를 모을 때의 페치 cap.
 * 6만 명 중 매핑 누락이 이 수보다 많으면 admin 이 매핑을 너무 오래 안 한 신호.
 */
const MISSING_FETCH_CAP = 5000;

export interface MissingSchoolRegion {
  /** 학교명 (NOT NULL — NULL 학교는 결과에서 제외). */
  school: string;
  /** 이 학교 소속이고 매핑 누락(region='기타') 인 학생 수. */
  student_count: number;
}

export async function listMissingSchoolRegions(): Promise<
  MissingSchoolRegion[]
> {
  if (isDevSeedMode()) {
    return collectFromDevSeed();
  }
  return collectFromSupabase();
}

function collectFromDevSeed(): MissingSchoolRegion[] {
  const mappedSchools = new Set<string>(DEV_SCHOOL_REGIONS.map((r) => r.school));
  const counts = new Map<string, number>();

  for (const p of DEV_STUDENT_PROFILES) {
    if (typeof p.school !== "string" || p.school.length === 0) continue;
    if (mappedSchools.has(p.school)) continue;
    counts.set(p.school, (counts.get(p.school) ?? 0) + 1);
  }

  return aggregateAndSort(counts);
}

async function collectFromSupabase(): Promise<MissingSchoolRegion[]> {
  const supabase = await createSupabaseServerClient();

  // student_profiles 뷰에서 region='기타' 이고 school NOT NULL 인 학생들의
  // 학교명만 모은다. 페이로드는 학교명 1컬럼이라 가벼움.
  const { data, error } = await supabase
    .from("student_profiles")
    .select("school")
    .eq("region", "기타")
    .not("school", "is", null)
    .neq("status", "탈퇴")
    .limit(MISSING_FETCH_CAP);

  if (error) {
    throw new Error(`매핑 누락 학교 조회에 실패했습니다: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{ school: string | null }>;
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (typeof r.school !== "string" || r.school.length === 0) continue;
    counts.set(r.school, (counts.get(r.school) ?? 0) + 1);
  }

  return aggregateAndSort(counts);
}

function aggregateAndSort(
  counts: Map<string, number>,
): MissingSchoolRegion[] {
  const items: MissingSchoolRegion[] = [];
  for (const [school, n] of counts) {
    items.push({ school, student_count: n });
  }
  items.sort((a, b) => {
    if (b.student_count !== a.student_count) {
      return b.student_count - a.student_count;
    }
    return a.school.localeCompare(b.school, "ko");
  });
  return items.slice(0, TOP_LIMIT);
}
