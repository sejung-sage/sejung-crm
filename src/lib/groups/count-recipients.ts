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
 * 쿼리 구조 (PostgREST `max_rows = 1000` 우회):
 *   1) unsubscribes.phone 목록을 먼저 페치 (수신거부 건수는 많지 않음).
 *   2) student_profiles 를 **두 번** 호출:
 *      (A) head + count: 헤더로 총 개수만 받기 (body 없음, cap 무관).
 *      (B) sample: 동일 필터 + LIMIT 5 로 상위 5명만.
 *   3) 수신거부 phone 제외는 **SQL 단** (PostgREST `.or(...)`) 에서 처리.
 *      JS 단에서 처리하면 (A)의 head 카운트가 수신거부 포함 값이 되어 부정확하므로
 *      반드시 SQL 단에서 동일 조건으로 적용해야 두 쿼리가 일관된다.
 *
 * 과거 구조: 전체 row 를 받아 JS 에서 카운트/제외 → student_profiles 가 1000행을
 * 넘으면 PostgREST 가 1000 에서 응답을 잘라 total 이 1000 에 고정되는 버그.
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

/** 수신거부 phone 값에 허용할 문자 패턴 (숫자/하이픈만). PostgREST `.or(...)` 인자로 박을 때
 *  콤마/괄호/슬래시 등 메타문자 인젝션을 방지. */
const SAFE_PHONE_PATTERN = /^[\d-]+$/;

/**
 * student_profiles 쿼리 빌더 헬퍼. (A) count 와 (B) sample 두 호출이 동일한 필터·동일한
 * 수신거부 제외 조건을 갖도록 한 곳에서 조립한다.
 *
 * - selectExpr: (A) 는 "id" + head 모드, (B) 는 본문 컬럼 전체.
 * - countOption: "exact" 면 head 카운트, undefined 면 일반 select.
 * - safeUnsubPhones: 정규식 통과한 수신거부 phone 만. 빈 배열이면 OR 절 자체를 추가하지 않는다
 *   (PostgREST 가 `not.in.()` 빈 인자에서 에러를 낼 수 있음).
 */
function buildStudentProfilesQuery(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  filters: GroupFilters,
  branch: string,
  safeUnsubPhones: string[],
  selectExpr: string,
  options: { count?: "exact"; head?: boolean } = {},
) {
  let query = supabase
    .from("student_profiles")
    .select(selectExpr, options)
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

  // 수신거부 phone 제외를 SQL 단에서 처리.
  // 의미: parent_phone IS NULL OR parent_phone NOT IN (수신거부 목록)
  //  - parent_phone 미보유 학생은 수신거부 매칭 자체가 불가하므로 통과.
  //  - 매칭되는 학생만 제외.
  // 빈 배열일 때는 절을 추가하지 않아 전체 통과 (PostgREST 빈 in 절 회피).
  if (safeUnsubPhones.length > 0) {
    query = query.or(
      `parent_phone.is.null,parent_phone.not.in.(${safeUnsubPhones.join(",")})`,
    );
  }

  return query;
}

async function countFromSupabase(
  filters: GroupFilters,
  branch: string,
): Promise<CountRecipientsResult> {
  const supabase = await createSupabaseServerClient();

  // 1) 수신거부 학부모 번호 목록 선(先)페치 → SQL 단 제외 절 인자로 사용.
  //    포맷 변환은 하지 않는다 (unsubscribes.phone 과 student_profiles.parent_phone 의
  //    포맷이 동일하다는 기존 가정 유지).
  const { data: unsubRows, error: unsubError } = await supabase
    .from("unsubscribes")
    .select("phone");
  if (unsubError) {
    throw new Error(
      `수신거부 목록 조회에 실패했습니다: ${unsubError.message}`,
    );
  }
  const safeUnsubPhones = (unsubRows ?? [])
    .map((r) => (r as { phone: string }).phone)
    .filter(
      (v): v is string =>
        typeof v === "string" && v.length > 0 && SAFE_PHONE_PATTERN.test(v),
    );

  // 2-A) 카운트 쿼리: head + count=exact 로 헤더만 받는다 (PostgREST max_rows cap 무관).
  const countQuery = buildStudentProfilesQuery(
    supabase,
    filters,
    branch,
    safeUnsubPhones,
    "id",
    { count: "exact", head: true },
  );
  const { count, error: countError } = await countQuery;
  if (countError) {
    throw new Error(`수신자 카운트 조회에 실패했습니다: ${countError.message}`);
  }

  // 2-B) 샘플 쿼리: 동일 필터에서 상위 5명만 가져와 미리보기에 사용.
  const sampleQuery = buildStudentProfilesQuery(
    supabase,
    filters,
    branch,
    safeUnsubPhones,
    "id, name, school, grade, track, status, branch, parent_phone, phone, registered_at, enrollment_count, total_paid, subjects, teachers, attendance_rate, last_attended_at, last_paid_at",
  );
  const { data: sampleData, error: sampleError } = await sampleQuery
    .order("registered_at", { ascending: false, nullsFirst: false })
    .limit(SAMPLE_SIZE);

  if (sampleError) {
    throw new Error(`수신자 조회에 실패했습니다: ${sampleError.message}`);
  }

  const sampleRows = (sampleData ?? []) as StudentProfileRow[];

  return {
    total: count ?? 0,
    sample: sampleRows.map(toSampleRow),
  };
}

function toSampleRow(p: StudentProfileRow) {
  return {
    name: p.name,
    school: p.school,
    grade: p.grade,
  };
}
