/**
 * 학교 → 지역 매핑 리스트 조회 (admin 화면용).
 *
 * 정책:
 *  - 페이지네이션 없음. 매핑 표는 전사 공용·소형(학교 수십~수백)이라 1000행 cap
 *    으로 상한만 두고 한 번에 모두 반환.
 *  - search: students.school 과 동일하게 자유 텍스트 ILIKE '%query%' (대소문자
 *    무시·한글 OK). 빈 문자열이면 무시.
 *  - region: 정확 일치(=). 빈 문자열이면 무시.
 *  - 정렬: region ASC, school ASC.
 *  - dev-seed 모드는 인메모리 DEV_SCHOOL_REGIONS 사용.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  DEV_SCHOOL_REGIONS,
  isDevSeedMode,
} from "@/lib/profile/students-dev-seed";
import type { SchoolRegionRow } from "@/types/database";

/** 매핑 표는 작아야 하므로 안전상한. 초과 시 admin UI 가 필터링을 강제. */
const MAX_ROWS = 1000;

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

async function listFromSupabase(
  search: string,
  region: string,
): Promise<SchoolRegionRow[]> {
  const supabase = await createSupabaseServerClient();

  let q = supabase
    .from("school_regions")
    .select("school, region, created_at, updated_at");

  if (region) {
    q = q.eq("region", region);
  }
  if (search) {
    // ILIKE 메타문자(%, _, 콤마, 괄호) 제거 후 그대로 박는다.
    const safe = search.replace(ILIKE_META_PATTERN, "").trim();
    if (safe.length > 0) {
      q = q.ilike("school", `%${safe}%`);
    }
  }

  const { data, error } = await q
    .order("region", { ascending: true })
    .order("school", { ascending: true })
    .limit(MAX_ROWS);

  if (error) {
    throw new Error(`지역 매핑 조회에 실패했습니다: ${error.message}`);
  }

  return (data ?? []) as SchoolRegionRow[];
}
