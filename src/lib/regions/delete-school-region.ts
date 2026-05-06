/**
 * 학교 → 지역 매핑 단건 삭제.
 *
 * 정책:
 *  - school PK 정확 일치로 삭제. 매칭 0건이면 success(no-op) — 멱등.
 *  - 삭제된 학교의 학생들은 student_profiles 뷰의 LEFT JOIN 결과
 *    region 이 '기타' 로 자동 fallback (0026 의 COALESCE).
 *  - 인증/권한은 호출부 (Server Action 레이어) 에서 선검증.
 *  - dev-seed 모드: 쓰기 차단.
 */

import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DevSeedReadOnlyError } from "./upsert-school-region";

export async function deleteSchoolRegion(school: string): Promise<void> {
  const trimmed = school.trim();
  if (trimmed.length === 0) {
    throw new Error("학교명이 비어있습니다");
  }

  if (isDevSeedMode()) {
    throw new DevSeedReadOnlyError();
  }

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("school_regions")
    .delete()
    .eq("school", trimmed);

  if (error) {
    throw new Error(`지역 매핑 삭제에 실패했습니다: ${error.message}`);
  }
}
