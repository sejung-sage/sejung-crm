/**
 * 매핑 누락 학교 리스트.
 *
 * "students 에 있지만 school_regions 에는 entry 자체가 없는" 학교를 학생 수
 * 내림차순으로 반환. admin "지역 매핑" UI 의 미매핑 섹션 핵심 데이터.
 *
 * 매칭 정책 (2026-05-15 재정의):
 *   미매핑 = school_regions 테이블에 entry 가 존재하지 않는 학교.
 *   '기타' 로 명시 분류된 학교도 entry 가 있으므로 "매핑된 것" 으로 취급되어
 *   미매핑 패널에서 빠진다. (이전 로직: region='기타' 학생의 학교 → 사용자가
 *   '기타'로 의도 분류한 학교도 계속 다시 잡혀 카운트가 줄지 않는 버그.)
 *
 *   학교명 NULL/빈 학생은 매핑 대상이 아니므로 결과에서 제외.
 *   status='탈퇴' 학생도 제외.
 *
 * 정렬: student_count DESC. cap 50 (한 번에 처리할 양).
 *
 * 구현:
 *   1) school_regions 전체 학교 set 조회 (수십~수백 행, 가벼움).
 *   2) students 에서 학교 컬럼만 페이지네이션으로 수집 (cap 1만 row).
 *   3) JS 단에서 mapped set 에 없는 학교만 학생 수 집계.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  DEV_SCHOOL_REGIONS,
  DEV_STUDENT_PROFILES,
  isDevSeedMode,
} from "@/lib/profile/students-dev-seed";

const TOP_LIMIT = 50;

// students 페이지네이션 cap. 6만 학생 풀스캔 가능하도록 1만 행.
const PAGE_SIZE = 1000;
const MAX_PAGES = 60;

export interface MissingSchoolRegion {
  /** 학교명 (NOT NULL — NULL 학교는 결과에서 제외). */
  school: string;
  /** 이 학교 소속이고 school_regions 에 매핑이 없는 학생 수 (탈퇴 제외). */
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

function normalizeSchoolKey(s: string): string {
  // NFC + trim — DB 0034/0035 마이그레이션 이후엔 보장되지만, ETL 일시 이탈 대비.
  return s.trim().normalize("NFC");
}

function collectFromDevSeed(): MissingSchoolRegion[] {
  const mappedSchools = new Set<string>(
    DEV_SCHOOL_REGIONS.map((r) => normalizeSchoolKey(r.school)),
  );
  const counts = new Map<string, number>();

  for (const p of DEV_STUDENT_PROFILES) {
    if (typeof p.school !== "string") continue;
    if (p.status === "탈퇴") continue;
    const s = normalizeSchoolKey(p.school);
    if (s.length === 0) continue;
    if (mappedSchools.has(s)) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }

  return aggregateAndSort(counts);
}

async function collectFromSupabase(): Promise<MissingSchoolRegion[]> {
  const supabase = await createSupabaseServerClient();

  // 1) school_regions 전체 매핑 학교 set.
  const { data: mappingRows, error: mappingError } = await supabase
    .from("school_regions")
    .select("school");
  if (mappingError) {
    throw new Error(
      `매핑 누락 학교 조회에 실패했습니다: ${mappingError.message}`,
    );
  }
  const mappedSchools = new Set<string>(
    ((mappingRows ?? []) as Array<{ school: string }>).map((r) =>
      normalizeSchoolKey(r.school),
    ),
  );

  // 2) students 에서 학교명 페이지네이션 수집.
  //    student_profiles 뷰가 아닌 students 테이블 직접 — JOIN/집계 없이 가볍게.
  const counts = new Map<string, number>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("students")
      .select("school")
      .not("school", "is", null)
      .neq("status", "탈퇴")
      .range(from, to);

    if (error) {
      throw new Error(
        `매핑 누락 학교 조회에 실패했습니다: ${error.message}`,
      );
    }

    const rows = (data ?? []) as Array<{ school: string | null }>;
    if (rows.length === 0) break;

    for (const r of rows) {
      if (typeof r.school !== "string") continue;
      const s = normalizeSchoolKey(r.school);
      if (s.length === 0) continue;
      if (mappedSchools.has(s)) continue;
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }

    if (rows.length < PAGE_SIZE) break;
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
