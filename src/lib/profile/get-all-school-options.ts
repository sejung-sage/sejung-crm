import { unstable_cache } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  DEV_SCHOOL_REGIONS,
  DEV_STUDENT_PROFILES,
  isDevSeedMode,
} from "./students-dev-seed";

/**
 * 학교명 자동완성용 풀.
 *
 * 출처: students.school distinct ∪ school_regions.school 합집합.
 * - students 에 실제로 등장한 학교는 모두 포함 (분원·status 무관)
 * - 매핑만 등록된 학교(예방 매핑) 도 포함 — 미래 학생이 정식명으로 들어올 때 대비
 *
 * 결과는 한글 정렬 distinct list. 학생 추가/수정 폼의 학교 combobox 에서 사용.
 *
 * 캐시: 60초 (학교가 자주 추가/제거되는 데이터 아니라 길어도 OK이지만
 *       매핑 admin 에서 새 학교 등록 후 곧 반영되도록 60초 유지).
 */

const CACHE_SECONDS = 60;
const PAGE_SIZE = 1000;
const MAX_PAGES = 60;

export async function getAllSchoolOptions(): Promise<string[]> {
  if (isDevSeedMode()) {
    return collectFromDevSeed();
  }
  return cachedCollectFromSupabase();
}

async function collectFromSupabase(): Promise<string[]> {
  const supabase = createSupabaseServiceClient();
  const set = new Set<string>();

  // 1) school_regions 의 학교 (매핑 풀 — 예방 매핑 포함).
  const { data: mappingRows } = await supabase
    .from("school_regions")
    .select("school");
  for (const r of (mappingRows ?? []) as Array<{ school: string }>) {
    if (typeof r.school === "string" && r.school.trim().length > 0) {
      set.add(r.school.trim().normalize("NFC"));
    }
  }

  // 2) students 에 실제로 등장한 학교 (분원·status 무관).
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("students")
      .select("school")
      .not("school", "is", null)
      .range(from, to);
    if (error) break;
    const rows = (data ?? []) as Array<{ school: string | null }>;
    if (rows.length === 0) break;
    for (const r of rows) {
      if (typeof r.school === "string" && r.school.trim().length > 0) {
        set.add(r.school.trim().normalize("NFC"));
      }
    }
    if (rows.length < PAGE_SIZE) break;
  }

  return [...set].sort((a, b) => a.localeCompare(b, "ko"));
}

const cachedCollectFromSupabase = unstable_cache(
  collectFromSupabase,
  ["all-school-options"],
  { revalidate: CACHE_SECONDS, tags: ["all-school-options"] },
);

function collectFromDevSeed(): string[] {
  const set = new Set<string>();
  for (const r of DEV_SCHOOL_REGIONS) {
    if (r.school?.trim()) set.add(r.school.trim());
  }
  for (const p of DEV_STUDENT_PROFILES) {
    if (typeof p.school === "string" && p.school.trim()) {
      set.add(p.school.trim());
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, "ko"));
}
