/**
 * F2 · 발송 그룹 수신자 카운트 (+ 상위 5명 미리보기)
 *
 * UI 의 필터 조작에 디바운스로 호출되는 경량 쿼리. 발송 시점에도 최종 카운트 확인에 재사용.
 *
 * 자동 제외 규칙 (사용자 확정 · MVP Phase 0):
 *   - students.status = '탈퇴' 제외
 *   - unsubscribes 에 학부모 번호 있는 학생 제외
 *   - "최근 3회 수신자 제외" 는 Phase 1 로 미룸 (여기서 다루지 않음)
 *
 * 주의: Supabase JS SDK 의 `.not('col', 'in', ...)` 에 서브쿼리 주입은
 * 인젝션 회피와 타입 안정성 이유로 **두 단계 호출** 사용:
 *   1) unsubscribes.phone 목록 페치
 *   2) student_profiles 쿼리 후 JS 레벨에서 해당 phone 제외
 * 수신거부 건수는 많지 않으므로 성능 이슈 없음.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { GroupFilters } from "@/lib/schemas/group";
import type { Grade, StudentProfileRow } from "@/types/database";
import {
  DEV_STUDENT_PROFILES,
  isDevSeedMode,
} from "@/lib/profile/students-dev-seed";
import { applyGroupFiltersDev } from "./apply-filters";

export interface CountRecipientsResult {
  total: number;
  sample: Array<{
    name: string;
    school: string | null;
    grade: Grade | null;
  }>;
}

const SAMPLE_SIZE = 5;

export async function countRecipients(
  filters: GroupFilters,
  branch: string,
): Promise<CountRecipientsResult> {
  if (isDevSeedMode()) {
    return countFromDevSeed(filters, branch);
  }
  return countFromSupabase(filters, branch);
}

function countFromDevSeed(
  filters: GroupFilters,
  branch: string,
): CountRecipientsResult {
  const matched = applyGroupFiltersDev(DEV_STUDENT_PROFILES, filters, branch);
  return {
    total: matched.length,
    sample: matched.slice(0, SAMPLE_SIZE).map(toSampleRow),
  };
}

async function countFromSupabase(
  filters: GroupFilters,
  branch: string,
): Promise<CountRecipientsResult> {
  const supabase = await createSupabaseServerClient();

  // 1) 수신거부 학부모 번호 목록 선(先)페치 → JS 레벨 제외에 사용
  const { data: unsubRows, error: unsubError } = await supabase
    .from("unsubscribes")
    .select("phone");
  if (unsubError) {
    throw new Error(
      `수신거부 목록 조회에 실패했습니다: ${unsubError.message}`,
    );
  }
  const unsub = new Set<string>(
    (unsubRows ?? [])
      .map((r) => (r as { phone: string }).phone)
      .filter((v): v is string => typeof v === "string" && v.length > 0),
  );

  // 2) student_profiles 뷰에서 분원 + filters 적용 + status ≠ '탈퇴'
  let query = supabase
    .from("student_profiles")
    .select(
      "id, name, school, grade, track, status, branch, parent_phone, phone, registered_at, enrollment_count, total_paid, subjects, teachers, attendance_rate, last_attended_at, last_paid_at",
    )
    .neq("status", "탈퇴");

  if (branch) {
    query = query.eq("branch", branch);
  }
  if (filters.grades.length > 0) {
    query = query.in("grade", filters.grades);
  }
  if (filters.schools.length > 0) {
    query = query.in("school", filters.schools);
  }
  if (filters.subjects.length > 0) {
    // student_profiles.subjects 는 array_agg 결과. overlaps 로 교집합 존재 확인.
    query = query.overlaps("subjects", filters.subjects);
  }

  // 카운트는 sample 5명만 서버에서 받고, total 은 별도 head 쿼리로.
  // 단, 수신거부 제외가 JS 필터라 정확한 total 은 전체 id 목록이 있어야 계산됨.
  // 수신거부 포함 대상 수가 수천 단위라도 (id, parent_phone) 두 컬럼이면 무겁지 않으므로
  // 전체를 받아 JS 에서 필터한 뒤 카운트 + 샘플.
  const { data, error } = await query.order("registered_at", {
    ascending: false,
    nullsFirst: false,
  });

  if (error) {
    throw new Error(`수신자 조회에 실패했습니다: ${error.message}`);
  }

  const rows = (data ?? []) as StudentProfileRow[];
  const filtered = rows.filter(
    (r) => !(r.parent_phone && unsub.has(r.parent_phone)),
  );

  return {
    total: filtered.length,
    sample: filtered.slice(0, SAMPLE_SIZE).map(toSampleRow),
  };
}

function toSampleRow(p: StudentProfileRow) {
  return {
    name: p.name,
    school: p.school,
    grade: p.grade,
  };
}
