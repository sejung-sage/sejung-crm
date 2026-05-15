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

/**
 * RPC 좁힌 인터페이스 — Database 타입에 list_unmapped_school_counts 가 아직
 * 생성되지 않아 캐스팅. supabase gen types 재실행 시 제거 가능.
 */
interface RpcCaller {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): Promise<{
    data: Array<{ school: string; student_count: number | string }> | null;
    error: { message: string } | null;
  }>;
}

async function collectFromSupabase(): Promise<MissingSchoolRegion[]> {
  const supabase = await createSupabaseServerClient();

  // PG RPC 한 번으로 집계 (0036 마이그레이션). 60번 round-trip → 1번.
  // 함수 정의: students LEFT JOIN school_regions, sr.school IS NULL 만, GROUP BY,
  //            ORDER BY student_count DESC LIMIT p_limit.
  const { data, error } = await (supabase as unknown as RpcCaller).rpc(
    "list_unmapped_school_counts",
    { p_limit: TOP_LIMIT },
  );

  if (error) {
    throw new Error(`매핑 누락 학교 조회에 실패했습니다: ${error.message}`);
  }

  return (data ?? []).map((r) => ({
    school: r.school,
    // PG bigint → JS number 변환. 6만 row 이하 가정에서 안전.
    student_count:
      typeof r.student_count === "string"
        ? Number.parseInt(r.student_count, 10)
        : r.student_count,
  }));
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
