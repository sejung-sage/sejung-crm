/**
 * 그룹 빌더의 "학생 직접 추가" 검색용 경량 함수.
 *
 * 입력은 이름 또는 학부모 연락처 일부 (>=2자). 분원 필터를 같이 적용해
 * 다른 분원 학생이 노출되지 않도록 한다.
 *
 * 반환은 최대 SEARCH_LIMIT 명. UI 에서 칩 추가용 콤보박스에 노출.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  DEV_STUDENT_PROFILES,
  isDevSeedMode,
} from "@/lib/profile/students-dev-seed";
import type { Grade } from "@/types/database";

export interface StudentSearchHit {
  id: string;
  name: string;
  parent_phone: string | null;
  school: string | null;
  grade: Grade | null;
  branch: string;
}

const SEARCH_LIMIT = 10;
const MIN_QUERY = 2;

export async function searchStudentsForGroup(
  query: string,
  branch: string,
): Promise<StudentSearchHit[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY) return [];

  if (isDevSeedMode()) {
    return searchFromDevSeed(trimmed, branch);
  }
  return searchFromSupabase(trimmed, branch);
}

function searchFromDevSeed(
  query: string,
  branch: string,
): StudentSearchHit[] {
  const branchTrim = branch.trim();
  const q = query.toLowerCase();
  return DEV_STUDENT_PROFILES.filter((p) => {
    if (branchTrim && p.branch !== branchTrim) return false;
    if (p.status === "탈퇴") return false;
    const nameHit = p.name.toLowerCase().includes(q);
    const phoneHit = p.parent_phone?.includes(query) ?? false;
    return nameHit || phoneHit;
  })
    .slice(0, SEARCH_LIMIT)
    .map((p) => ({
      id: p.id,
      name: p.name,
      parent_phone: p.parent_phone,
      school: p.school,
      grade: p.grade,
      branch: p.branch,
    }));
}

async function searchFromSupabase(
  query: string,
  branch: string,
): Promise<StudentSearchHit[]> {
  const supabase = await createSupabaseServerClient();

  // 콤마/괄호/% 메타문자 제거 (PostgREST .or 인젝션 방어).
  const safe = query.replace(/[,()%]/g, "").trim();
  if (safe.length < MIN_QUERY) return [];

  // crm_students 인덱스(0046 branch+status, 학교명 partial) 활용.
  // student_profiles 뷰의 풀 집계 LEFT JOIN 회피 — 검색은 10건만 뽑아도
  // 뷰 쿼리는 GROUP BY 전체를 거치므로 큰 비용.
  let q = supabase
    .from("crm_students")
    .select("id, name, parent_phone, school, grade, branch")
    .neq("status", "탈퇴")
    .or(`name.ilike.%${safe}%,parent_phone.ilike.%${safe}%`)
    .limit(SEARCH_LIMIT);

  if (branch.trim()) {
    q = q.eq("branch", branch.trim());
  }

  const { data, error } = await q;
  if (error) {
    throw new Error(`학생 검색에 실패했습니다: ${error.message}`);
  }

  return (data ?? []).map((r) => {
    const row = r as {
      id: string;
      name: string;
      parent_phone: string | null;
      school: string | null;
      grade: Grade | null;
      branch: string;
    };
    return {
      id: row.id,
      name: row.name,
      parent_phone: row.parent_phone,
      school: row.school,
      grade: row.grade,
      branch: row.branch,
    };
  });
}
