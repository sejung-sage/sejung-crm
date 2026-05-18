/**
 * 학교 → 지역 매핑 리스트 조회 (admin 화면용).
 *
 * 정책 (2026-05-18 — 0042 RPC 도입):
 *  - 학생 데이터에 EXISTS 인 매핑만 반환. /students 의 학교 필터와 동일한
 *    학교 집합을 노출 — 정식명+줄임형 중복 / 학생 없는 예방 매핑 노이즈 제거.
 *  - 0040 시드로 school_regions 가 수천 row 로 커졌으나 RPC 가 PG 단에서
 *    EXISTS + 정렬 한 번에 처리. 결과는 학생 데이터의 학교 distinct 수 이내.
 *  - search: 자유 텍스트 부분 일치(ILIKE). 빈 문자열이면 무시.
 *  - region: 정확 일치. 빈 문자열이면 무시.
 *  - 정렬: region ASC, school ASC (RPC 내부).
 *  - dev-seed 모드는 인메모리 DEV_SCHOOL_REGIONS 사용.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  DEV_SCHOOL_REGIONS,
  isDevSeedMode,
} from "@/lib/profile/students-dev-seed";
import type { SchoolRegionRow } from "@/types/database";

export interface ListSchoolRegionsQuery {
  /** 학교명 부분일치(ILIKE). 빈/미지정이면 무시. */
  search?: string;
  /** 지역명 정확일치. 빈/미지정이면 무시. */
  region?: string;
}

/** PostgREST `.or` 인자에 박을 때 메타문자 인젝션 방지. */
const ILIKE_META_PATTERN = /[,()%]/g;

export async function listSchoolRegions(
  query?: ListSchoolRegionsQuery,
): Promise<SchoolRegionRow[]> {
  const search = query?.search?.trim() ?? "";
  const region = query?.region?.trim() ?? "";

  if (isDevSeedMode()) {
    return listFromDevSeed(search, region);
  }
  return listFromSupabase(search, region);
}

function listFromDevSeed(search: string, region: string): SchoolRegionRow[] {
  // dev-seed 는 개발용 정적 데이터 — 모든 매핑 노출 (운영처럼 EXISTS 좁힘 안 함).
  // 운영 경로(Supabase RPC) 만 학생 데이터와 일치한 학교로 좁힘.
  const lc = search.toLowerCase();
  return [...DEV_SCHOOL_REGIONS]
    .filter((r) => {
      if (region && r.region !== region) return false;
      if (search && !r.school.toLowerCase().includes(lc)) return false;
      return true;
    })
    .sort((a, b) => {
      const r = a.region.localeCompare(b.region, "ko");
      if (r !== 0) return r;
      return a.school.localeCompare(b.school, "ko");
    });
}

/** RPC 좁힌 인터페이스 — Database 타입에 새 RPC 미반영 시 캐스팅. */
interface RpcCaller {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
}

async function listFromSupabase(
  search: string,
  region: string,
): Promise<SchoolRegionRow[]> {
  const supabase = await createSupabaseServerClient();

  // ILIKE 메타문자 제거 (인젝션·문법 가드). RPC 안에서 `%||search||%` 합성하므로
  // 호출부에서 % / _ / 콤마 / 괄호 등 제거.
  const safeSearch = search
    ? search.replace(ILIKE_META_PATTERN, "").trim()
    : "";

  const { data, error } = await (supabase as unknown as RpcCaller).rpc(
    "list_school_regions_with_students",
    {
      p_search: safeSearch.length > 0 ? safeSearch : null,
      p_region: region ? region : null,
    },
  );

  if (error) {
    throw new Error(`지역 매핑 조회에 실패했습니다: ${error.message}`);
  }

  return ((data ?? []) as SchoolRegionRow[]);
}
