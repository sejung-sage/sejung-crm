/**
 * 강좌 + 회차(수업일) **포함** 필터를 student_id 목록으로 해석한다.
 *
 * 수신자 산정의 주 경로(search_recipients / search_recipients_bulk RPC · 0118)는
 * 이 세미조인을 SQL 안에서 처리하므로 본 모듈을 쓰지 않는다. 본 모듈은 RPC 를 못 쓰는
 * 보조 경로 전용이다 — 구체적으로 미리보기의 "탈퇴 N명 자동 제외" 배지 카운트
 * (preview-recipients 의 countWithdrawn) 가 crm_students 를 직접 쿼리한다.
 *
 * 그 카운트를 같은 모집단 위에서 세지 않으면, 강좌를 하나 골랐는데 분원 전체 기준
 * 탈퇴 수가 배지에 찍혀 운영자가 숫자를 못 믿게 된다.
 *
 * 경로: crm_classes.id → aca_class_id → aca_tickets(+class_date) → aca_student_id
 *       → crm_students.aca2000_id → crm_students.id
 *
 * 규모: 강좌 1개 회차 명단은 보통 수십 명. 강좌를 여럿 골라도 수백 명 수준이라
 * 청크 IN 조회로 충분하다.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/** PostgREST 기본 max_rows cap — 티켓 페이지 크기. */
const TICKET_PAGE = 1000;
/** crm_students IN(...) 청크 — URL 한도 방어. */
const STUDENT_LOOKUP_CHUNK = 200;

/**
 * 강좌(+회차) 포함 필터 → crm_students.id 목록.
 *
 * 반환 규약 — `null` 과 `[]` 의 의미가 다르다:
 *   - `null` : 조건 미적용 (classIds 가 비었음) → 호출부는 좁히지 않는다.
 *   - `[]`   : 조건은 걸렸는데 매칭 0명 → 호출부는 결과를 0건으로 확정해야 한다.
 * 이 둘을 뭉뚱그리면 "조건이 조용히 무시돼 전원에게 발송" 이 된다.
 *
 * @param classIds crm_classes.id 목록. 빈 배열이면 null 반환.
 * @param classDates 'YYYY-MM-DD' 목록. 빈 배열이면 선택 강좌의 전 회차.
 */
export async function loadIncludedClassStudentIds(
  supabase: SupabaseClient<Database>,
  classIds: readonly string[],
  classDates: readonly string[],
): Promise<string[] | null> {
  if (classIds.length === 0) return null;

  // 1) crm_classes.id → aca_class_id. NULL(자체 등록 강좌)은 티켓이 없어 매칭 불가.
  const { data: classRows, error: classErr } = await supabase
    .from("crm_classes")
    .select("aca_class_id")
    .in("id", classIds as string[])
    .not("aca_class_id", "is", null);
  if (classErr) {
    throw new Error(`강좌 조회에 실패했습니다: ${classErr.message}`);
  }
  const acaClassIds = (
    (classRows ?? []) as Array<{ aca_class_id: string | null }>
  )
    .map((r) => r.aca_class_id)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  // 고른 강좌가 전부 자체 등록이면 매칭 0명 (조건 무시 아님).
  if (acaClassIds.length === 0) return [];

  // 2) aca_tickets → distinct aca_student_id. 회차 지정이 있으면 그 수업일만.
  const acaStudentIds = new Set<string>();
  for (let from = 0; ; from += TICKET_PAGE) {
    let q = supabase
      .from("aca_tickets")
      .select("aca_student_id")
      .in("aca_class_id", acaClassIds)
      .not("aca_student_id", "is", null);
    if (classDates.length > 0) {
      q = q.in("class_date", classDates as string[]);
    }
    const { data, error } = await q.range(from, from + TICKET_PAGE - 1);
    if (error) {
      throw new Error(`수강권 조회에 실패했습니다: ${error.message}`);
    }
    const rows = (data ?? []) as Array<{ aca_student_id: string | null }>;
    for (const r of rows) {
      if (r.aca_student_id) acaStudentIds.add(r.aca_student_id);
    }
    if (rows.length < TICKET_PAGE) break;
  }
  if (acaStudentIds.size === 0) return [];

  // 3) aca2000_id → crm_students.id (청크 IN).
  const acaList = Array.from(acaStudentIds);
  const studentIds: string[] = [];
  for (let i = 0; i < acaList.length; i += STUDENT_LOOKUP_CHUNK) {
    const chunk = acaList.slice(i, i + STUDENT_LOOKUP_CHUNK);
    const { data, error } = await supabase
      .from("crm_students")
      .select("id")
      .in("aca2000_id", chunk);
    if (error) {
      throw new Error(`수강생 조회에 실패했습니다: ${error.message}`);
    }
    for (const r of (data ?? []) as Array<{ id: string }>) {
      if (r.id) studentIds.push(r.id);
    }
  }
  return studentIds;
}

/**
 * 두 "허용 id 목록" 을 교집합으로 합친다. null = 조건 미적용.
 *
 *   null ∩ null → null   (양쪽 다 조건 없음)
 *   null ∩ A    → A      (한쪽만 조건 있음)
 *   A    ∩ B    → 교집합  (둘 다 조건 있음 — AND 시맨틱)
 *
 * 과목 필터와 강좌 필터를 동시에 걸면 "그 과목이면서 그 강좌" 가 맞다(AND).
 */
export function intersectAllowedIds(
  a: string[] | null,
  b: string[] | null,
): string[] | null {
  if (a === null) return b;
  if (b === null) return a;
  const setB = new Set(b);
  return a.filter((id) => setB.has(id));
}
