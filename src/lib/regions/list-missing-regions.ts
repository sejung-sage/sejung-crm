/**
 * 매핑 누락 학교 리스트 + 전체 개수.
 *
 * "students 에 있지만 school_regions 에는 entry 자체가 없는" 학교를 학생 수
 * 내림차순으로 반환. admin "지역 매핑" UI 의 미매핑 섹션 핵심 데이터.
 *
 * 매칭 정책 (2026-05-15 재정의):
 *   미매핑 = school_regions 테이블에 entry 가 존재하지 않는 학교.
 *   '기타' 로 명시 분류된 학교도 entry 가 있으므로 "매핑된 것" 으로 취급되어
 *   미매핑 패널에서 빠진다.
 *
 *   status='재원생' 학생만 카운트 (학생 명단 default 와 일치, 0037).
 *   학교명 NULL 학생 제외.
 *
 * 반환:
 *   - items: 학생 수 많은 순 cap TOP_LIMIT 개. UI 본문 표시용.
 *   - total: 미매핑 학교 distinct 전체 개수. UI 헤더 표시용. cap 이상이면
 *     사용자가 매핑 추가해도 items 길이는 그대로지만 total 은 감소 → 진척이
 *     보이게 한다.
 *
 * 구현:
 *   Supabase: list / count 두 RPC 병렬 호출 (0036/0037 + 0038).
 *   Dev seed: JS Set 으로 양쪽 동시 계산.
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
  /** 이 학교 소속이고 school_regions 에 매핑이 없는 재원생 수. */
  student_count: number;
}

export interface MissingSchoolsResult {
  /** 학생 수 많은 순 cap TOP_LIMIT 개. */
  items: MissingSchoolRegion[];
  /** 미매핑 학교 distinct 전체 개수 (cap 이전). */
  total: number;
  /** UI 가 cap 이상 안내 메시지를 띄울 때 참고. */
  limit: number;
}

/**
 * 미매핑 학교 list + total 반환.
 * (구 시그니처 호환을 위한 별도 export 는 두지 않음 — 호출부 1곳뿐이라 안전.)
 */
export async function listMissingSchoolRegions(): Promise<MissingSchoolsResult> {
  if (isDevSeedMode()) {
    return collectFromDevSeed();
  }
  return collectFromSupabase();
}

function normalizeSchoolKey(s: string): string {
  // NFC + trim — DB 0034/0035 마이그레이션 이후엔 보장되지만, ETL 일시 이탈 대비.
  return s.trim().normalize("NFC");
}

function collectFromDevSeed(): MissingSchoolsResult {
  const mappedSchools = new Set<string>(
    DEV_SCHOOL_REGIONS.map((r) => normalizeSchoolKey(r.school)),
  );
  const counts = new Map<string, number>();

  for (const p of DEV_STUDENT_PROFILES) {
    if (typeof p.school !== "string") continue;
    if (p.status !== "재원생") continue;
    const s = normalizeSchoolKey(p.school);
    if (s.length === 0) continue;
    if (mappedSchools.has(s)) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }

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
  return {
    items: items.slice(0, TOP_LIMIT),
    total: items.length,
    limit: TOP_LIMIT,
  };
}

/**
 * RPC 좁힌 인터페이스 — Database 타입에 list/count_unmapped_school_counts 가 아직
 * 생성되지 않아 캐스팅. supabase gen types 재실행 시 제거 가능.
 */
interface RpcCaller {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
}

async function collectFromSupabase(): Promise<MissingSchoolsResult> {
  const supabase = await createSupabaseServerClient();
  const rpc = supabase as unknown as RpcCaller;

  // list 와 count 두 RPC 병렬 호출.
  const [listResult, countResult] = await Promise.all([
    rpc.rpc("list_unmapped_school_counts", { p_limit: TOP_LIMIT }),
    rpc.rpc("count_unmapped_schools"),
  ]);

  if (listResult.error) {
    throw new Error(
      `매핑 누락 학교 조회에 실패했습니다: ${listResult.error.message}`,
    );
  }

  const listRows =
    (listResult.data ?? []) as Array<{
      school: string;
      student_count: number | string;
    }>;
  const items: MissingSchoolRegion[] = listRows.map((r) => ({
    school: r.school,
    student_count:
      typeof r.student_count === "string"
        ? Number.parseInt(r.student_count, 10)
        : r.student_count,
  }));

  // count 함수가 실패해도 list 는 살린다 — total fallback 으로 items.length.
  let total = items.length;
  if (!countResult.error && countResult.data != null) {
    const raw = countResult.data;
    if (typeof raw === "number") {
      total = raw;
    } else if (typeof raw === "string") {
      total = Number.parseInt(raw, 10);
    } else if (typeof raw === "bigint") {
      total = Number(raw);
    }
  }

  return { items, total, limit: TOP_LIMIT };
}
