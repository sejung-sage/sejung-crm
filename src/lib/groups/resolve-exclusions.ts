/**
 * F2 발송 그룹 · 학교별 제외 + 강좌별 제외 공통 해석기.
 *
 * 박은주 부원장 요청(2026-05-27). 기존 그룹 제외는 개별 학생(excludeStudentIds)
 * 단위만 가능했는데, 학교 단위(학교별 진도차로 일부 학교만 빼고 발송) + 강좌 단위
 * (교재 이미 받은 강좌 수강생 제외) 제외를 추가한다.
 *
 * 적용 순서 (모든 수신자 해석 경로 동일):
 *   ① include 산정 (조건 ∪ includeStudentIds)
 *   ② exclude 차감 (excludeStudentIds + excludeSchools + excludeClassIds.
 *      include 와 겹치면 exclude 승리)
 *   ③ 탈퇴/수신거부 자동 제외 (기존 유지·독립 — 가드)
 *
 * 본 모듈은 ② 중 학교/강좌 차감을 위한 두 헬퍼를 제공:
 *   - `applySchoolExclusion`        : crm_students 쿼리에 `school NOT IN (...)` 차감
 *   - `loadExcludedClassStudentIds` : excludeClassIds → 차감 대상 student_id[] 사전 페치
 *
 * RPC 경로(search_recipients_by_subjects)는 0076 에서 SQL 내 NOT EXISTS 로 직접
 * 처리하므로 본 모듈을 쓰지 않는다. 비-RPC(crm_students 직접 쿼리) 경로 전용.
 *
 * 매핑 규칙:
 *   - excludeSchools : student.school IN (excludeSchools) 면 제외.
 *                      school IS NULL 은 차감 대상 아님(매칭 안 됨).
 *   - excludeClassIds: crm_classes.id IN (excludeClassIds) → aca_class_id 페치 →
 *                      crm_enrollments.aca_class_id 매칭 student_id 차감.
 *                      aca_class_id NULL(자체 등록 강좌)은 매칭 0명.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * PostgREST `in`/`not.in` 리스트 값 인코딩.
 *
 * `.in("school", arr)` 배열 형태는 PostgREST 가 자동 인코딩하지만, 제외는
 * `.not("school","in","(...)")` 문자열 형태라서 직접 인코딩해야 한다. 학교명에
 * 콤마·괄호·따옴표가 들어올 수 있으므로 각 값을 큰따옴표로 감싸고 내부 큰따옴표는
 * 두 번 반복(PostgREST/CSV 규칙)으로 이스케이프한다.
 *
 * 예) ["서울고", "A,B고"] → `"서울고","A,B고"`
 *     ["12\"중"]          → `"12""중"`
 */
export function encodePostgrestInList(values: readonly string[]): string {
  return values.map((v) => `"${v.replace(/"/g, '""')}"`).join(",");
}

/**
 * excludeSchools 를 crm_students 쿼리에 차감 적용.
 *
 * - 빈 배열이면 필터 미적용(쿼리 그대로 반환). 불필요한 `.not(... in ())` 는
 *   구문오류/전체제외 위험이 있어 절대 추가하지 않는다.
 * - school IS NULL 인 학생은 `NOT IN` 에 자연히 걸리지 않아 차감되지 않는다
 *   (계약: school IS NULL 은 제외 대상 아님). PostgREST 의 NOT IN 은 NULL 을
 *   탈락시키지 않으므로 별도 OR 분기 불필요.
 *
 * 제네릭 Q 로 빌더 체인 타입을 보존한다 (any 금지).
 */
export function applySchoolExclusion<Q extends { not(col: string, op: string, val: string): Q }>(
  query: Q,
  excludeSchools: readonly string[],
): Q {
  if (excludeSchools.length === 0) return query;
  return query.not("school", "in", `(${encodePostgrestInList(excludeSchools)})`);
}

/**
 * excludeClassIds(crm_classes.id) → 차감 대상 student_id 목록 사전 페치.
 *
 * 경로: crm_classes.id IN (excludeClassIds) → aca_class_id(NULL 제외) →
 *       crm_enrollments.aca_class_id 매칭 student_id distinct.
 *
 * 성능: 강좌 수는 보통 1~수개라 2회 쿼리(classes / enrollments)로 끝난다.
 * 60K 규모에서도 enrollments(aca_class_id) 인덱스로 작은 서브셋만 스캔.
 *
 * 반환:
 *   - 빈 배열 입력 → []         (차감 없음)
 *   - aca_class_id 가 전부 NULL → [] (자체 등록 강좌만 — 매칭 0명)
 *   - 매칭 enrollment 없음 → []
 *   - 그 외 → distinct student_id[]
 */
export async function loadExcludedClassStudentIds(
  supabase: SupabaseClient<Database>,
  excludeClassIds: readonly string[],
): Promise<string[]> {
  if (excludeClassIds.length === 0) return [];

  // 1) crm_classes.id → aca_class_id (NULL = 자체 등록 강좌라 매칭 불가).
  const { data: classRows, error: classErr } = await supabase
    .from("crm_classes")
    .select("aca_class_id")
    .in("id", excludeClassIds as string[])
    .not("aca_class_id", "is", null);
  if (classErr) {
    throw new Error(`제외 강좌 조회에 실패했습니다: ${classErr.message}`);
  }
  const acaClassIds = (
    (classRows ?? []) as Array<{ aca_class_id: string | null }>
  )
    .map((r) => r.aca_class_id)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  if (acaClassIds.length === 0) return [];

  // 2) crm_enrollments.aca_class_id 매칭 student_id distinct.
  const { data: enrollRows, error: enrollErr } = await supabase
    .from("crm_enrollments")
    .select("student_id")
    .in("aca_class_id", acaClassIds);
  if (enrollErr) {
    throw new Error(`제외 강좌 수강 정보 조회에 실패했습니다: ${enrollErr.message}`);
  }
  const set = new Set<string>();
  for (const r of (enrollRows ?? []) as Array<{ student_id: string }>) {
    if (r.student_id) set.add(r.student_id);
  }
  return Array.from(set);
}

/**
 * excludeStudentIds(명시 제외) ∪ excludeClassStudentIds(강좌 제외 펼침) 를
 * 하나의 not.in 차감용 uuid 목록으로 합친다.
 *
 * 둘 다 uuid 라 메타문자 인젝션 위험 없음 — `(${ids.join(",")})` 그대로 사용.
 * 빈 배열이면 [] 반환 (호출부에서 길이 검사 후 not 미적용).
 */
export function mergeExcludedStudentIds(
  excludeStudentIds: readonly string[],
  excludeClassStudentIds: readonly string[],
): string[] {
  if (excludeStudentIds.length === 0 && excludeClassStudentIds.length === 0) {
    return [];
  }
  const set = new Set<string>(excludeStudentIds);
  for (const id of excludeClassStudentIds) set.add(id);
  return Array.from(set);
}
