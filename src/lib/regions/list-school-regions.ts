/**
 * 학교 → 지역 매핑 리스트 조회 (admin 화면용).
 *
 * 정책:
 *  - 페이지네이션 (1000행 단위) — 0040 시드 후 매핑 row 가 수천개로 커져
 *    단일 limit(1000) 으론 일부만 가져와서 화면에 region 누락 현상 발생.
 *    PostgREST 의 max_rows 제약(기본 1000) 회피용 range 분할 fetch.
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

const PAGE_SIZE = 1000;
/** 안전상한 — 1000 × 20 = 2만 row 까지. 그 이상이면 검색·필터 강제. */
const MAX_PAGES = 20;

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

  // ILIKE 메타문자 제거(인젝션·문법 가드).
  const safeSearch = search
    ? search.replace(ILIKE_META_PATTERN, "").trim()
    : "";

  const all: SchoolRegionRow[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let q = supabase
      .from("school_regions")
      .select("school, region, created_at, updated_at")
      .order("region", { ascending: true })
      .order("school", { ascending: true })
      .range(from, to);

    if (region) q = q.eq("region", region);
    if (safeSearch.length > 0) q = q.ilike("school", `%${safeSearch}%`);

    const { data, error } = await q;
    if (error) {
      throw new Error(`지역 매핑 조회에 실패했습니다: ${error.message}`);
    }

    const rows = (data ?? []) as SchoolRegionRow[];
    if (rows.length === 0) break;
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  return all;
}
