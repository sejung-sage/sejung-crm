/**
 * 발송용 수신자 전체 일괄 로더.
 *
 * 기존 `listGroupStudents` 는 50건/페이지로 페이지네이션 + 페이지마다 head 카운트 +
 * unsubscribes 쿼리를 반복했다. 60K 수신자 발송 시 페이지당 4 쿼리 × 1,200 페이지 =
 * 약 5,000 라운드트립으로 Server Action 300s 타임아웃을 초과했다.
 *
 * 본 함수는 발송 큐 적재 직전 eligible 재조회 전용. 다음을 보장한다:
 *   - unsubscribes 1회만 페치
 *   - getGroup 1회만 호출
 *   - student_profiles 를 PostgREST `max_rows` cap (1,000) 청크로 range 페치
 *   - 60K 기준 약 62 쿼리 (1 + 1 + 60)
 *
 * 주의: CHUNK_SIZE 는 반드시 PostgREST `max_rows` (supabase/config.toml 의
 * `max_rows = 1000`) 이하여야 한다. cap 보다 크면 서버가 무성 잘라서 응답하고,
 * `rows.length < requestedSize` early break 조건에 즉시 걸려 첫 cap 분량만
 * 수집되는 버그가 난다. (2026-05-11 10,083명 캠페인이 1,000명만 발송된 회귀.)
 *
 * 필터 정책은 count-recipients.ts 와 동일. includeStudentIds 우선, 분원·탈퇴·
 * 수신거부 가드는 항상 적용.
 *
 * 호출자는 Supabase 클라이언트를 주입한다 — Server Action 은 server 클라이언트,
 * cron 디스패처는 service 클라이언트를 사용.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getGroup } from "./get-group";
import type { Database, StudentStatus } from "@/types/database";

/** PostgREST `max_rows` cap (supabase/config.toml). 이보다 크게 잡으면 cap 으로
 *  잘려 early break 회귀가 발생한다. */
const CHUNK_SIZE = 1_000;
const SAFE_PHONE_PATTERN = /^[\d-]+$/;

export interface GroupRecipient {
  id: string;
  name: string;
  parent_phone: string | null;
  status: StudentStatus;
}

export async function loadAllGroupRecipients(
  supabase: SupabaseClient<Database>,
  groupId: string,
  maxRecipients: number,
): Promise<GroupRecipient[]> {
  const group = await getGroup(groupId);
  if (!group) return [];

  // 1) unsubscribes 1회만 페치
  const { data: unsubRows, error: unsubError } = await supabase
    .from("crm_unsubscribes")
    .select("phone");
  if (unsubError) {
    throw new Error(`수신거부 목록 조회 실패: ${unsubError.message}`);
  }
  const safeUnsubPhones = (unsubRows ?? [])
    .map((r) => (r as { phone: string }).phone)
    .filter(
      (v): v is string =>
        typeof v === "string" && v.length > 0 && SAFE_PHONE_PATTERN.test(v),
    );

  // 2) student_profiles 를 청크 range 페치
  const collected: GroupRecipient[] = [];
  let from = 0;

  while (collected.length < maxRecipients) {
    const to = Math.min(from + CHUNK_SIZE - 1, maxRecipients - 1);

    let q = supabase
      .from("student_profiles")
      .select("id, name, parent_phone, status")
      .neq("status", "탈퇴")
      .eq("branch", group.branch);

    if (group.filters.includeStudentIds.length > 0) {
      q = q.in("id", group.filters.includeStudentIds);
    } else {
      if (group.filters.grades.length > 0) {
        q = q.in("grade", group.filters.grades);
      }
      if (group.filters.schools.length > 0) {
        q = q.in("school", group.filters.schools);
      }
      if (group.filters.subjects.length > 0) {
        q = q.overlaps("subjects", group.filters.subjects);
      }
      if (group.filters.regions.length > 0) {
        q = q.in("region", group.filters.regions);
      }
    }

    if (safeUnsubPhones.length > 0) {
      q = q.or(
        `parent_phone.is.null,parent_phone.not.in.(${safeUnsubPhones.join(",")})`,
      );
    }

    const { data, error } = await q
      .order("registered_at", { ascending: false, nullsFirst: false })
      .range(from, to);

    if (error) {
      throw new Error(`수신자 일괄 조회 실패: ${error.message}`);
    }

    const rows = (data ?? []) as GroupRecipient[];
    collected.push(...rows);

    // 마지막 청크 (요청 크기보다 적게 받음) 면 종료
    if (rows.length < to - from + 1) break;

    from = to + 1;
    if (from >= maxRecipients) break;
  }

  return collected;
}
