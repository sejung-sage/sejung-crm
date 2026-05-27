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
 *   - crm_students 직접 청크 range 페치 (view 풀집계 우회 — count-recipients 와
 *     동일 패턴. subjects/regions 사전 매핑으로 좁힘)
 *   - 60K 기준 약 62 쿼리 (1 + 1 + 60)
 *
 * 주의: CHUNK_SIZE 는 반드시 PostgREST `max_rows` (supabase/config.toml 의
 * `max_rows = 1000`) 이하여야 한다. cap 보다 크면 서버가 무성 잘라서 응답하고,
 * `rows.length < requestedSize` early break 조건에 즉시 걸려 첫 cap 분량만
 * 수집되는 버그가 난다. (2026-05-11 10,083명 캠페인이 1,000명만 발송된 회귀.)
 *
 * 필터 정책은 count-recipients.ts 와 동일.
 *   - includeStudentIds 우선
 *   - subjects: classes JOIN enrollments 사전 매핑 (ETL 상 enrollments.subject NULL)
 *   - regions: crm_school_regions 사전 매핑
 *   - 빈 statuses default = ['재원생', '수강이력자', '수강 x'] (탈퇴 제외)
 *   - 분원·탈퇴·수신거부 가드 항상 적용
 *
 * 호출자는 Supabase 클라이언트를 주입한다 — Server Action 은 server 클라이언트,
 * cron 디스패처는 service 클라이언트를 사용.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getGroup } from "./get-group";
import { getUnsubscribedPhones } from "@/lib/messaging/unsubscribed-phones";
import { isAllSubjects } from "@/lib/schemas/common";
import type { Database, StudentStatus } from "@/types/database";
import {
  UNMAPPED_SCHOOL_OR_EXPR,
  applyMappedSchoolFilter,
} from "@/lib/profile/list-students";
import {
  applySchoolExclusion,
  loadExcludedClassStudentIds,
  mergeExcludedStudentIds,
} from "./resolve-exclusions";

/** PostgREST `max_rows` cap (supabase/config.toml). 이보다 크게 잡으면 cap 으로
 *  잘려 early break 회귀가 발생한다. */
const CHUNK_SIZE = 1_000;

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

  // 1) 수신거부 phone — React cache dedupe (preview/count-recipients 와 공유).
  const safeUnsubPhones = await getUnsubscribedPhones();

  // 2) subjects 사전 매핑 — count-recipients 와 동일 정책.
  //    ETL 상 enrollments.subject 는 NULL → classes.subject 로 두 단계 매핑.
  //    7종 전체 체크 = "조건 없음" 으로 정규화.
  let subjectMatchedStudentIds: string[] | null = null;
  if (
    group.filters.includeStudentIds.length === 0 &&
    group.filters.subjects.length > 0 &&
    !isAllSubjects(group.filters.subjects)
  ) {
    const { data: classRows, error: classErr } = await supabase
      .from("crm_classes")
      .select("aca_class_id")
      .in("subject", group.filters.subjects)
      .not("aca_class_id", "is", null);
    if (classErr) {
      throw new Error(`강좌 조회에 실패했습니다: ${classErr.message}`);
    }
    const acaClassIds = (
      (classRows ?? []) as Array<{ aca_class_id: string | null }>
    )
      .map((r) => r.aca_class_id)
      .filter((v): v is string => typeof v === "string" && v.length > 0);
    if (acaClassIds.length === 0) return [];

    const { data: enrollRows, error: enrollErr } = await supabase
      .from("crm_enrollments")
      .select("student_id")
      .in("aca_class_id", acaClassIds);
    if (enrollErr) {
      throw new Error(`수강 정보 조회에 실패했습니다: ${enrollErr.message}`);
    }
    const set = new Set<string>();
    for (const r of (enrollRows ?? []) as Array<{ student_id: string }>) {
      if (r.student_id) set.add(r.student_id);
    }
    if (set.size === 0) return [];
    subjectMatchedStudentIds = Array.from(set);
  }

  // 3) regions 사전 매핑 — crm_school_regions 에서 매칭 school 페치.
  let allowedSchools: string[] | null = null;
  if (
    group.filters.regions.length > 0 &&
    group.filters.includeStudentIds.length === 0
  ) {
    const { data: regionRows, error: regErr } = await supabase
      .from("crm_school_regions")
      .select("school")
      .in("region", group.filters.regions);
    if (regErr) {
      throw new Error(`지역 매핑 조회에 실패했습니다: ${regErr.message}`);
    }
    allowedSchools = (regionRows ?? [])
      .map((r) => (r as { school: string }).school)
      .filter((s): s is string => typeof s === "string" && s.length > 0);
    if (allowedSchools.length === 0) return [];
  }

  // 3.5) 강좌별 제외 사전 페치 — excludeClassIds(crm_classes.id) → aca_class_id →
  //      crm_enrollments 매칭 student_id. 강좌 수가 적어 1회성 페치.
  //      include/조건 분기 무관하게 항상 차감(exclude 승리).
  const excludeClassStudentIds = await loadExcludedClassStudentIds(
    supabase,
    group.filters.excludeClassIds ?? [],
  );
  // 명시 제외(excludeStudentIds) + 강좌 제외 펼침을 하나의 not.in uuid 목록으로 병합.
  const mergedExcludeIds = mergeExcludedStudentIds(
    group.filters.excludeStudentIds ?? [],
    excludeClassStudentIds,
  );
  const excludeSchools = group.filters.excludeSchools ?? [];

  // 4) crm_students 직접 청크 range 페치 (view 풀집계 우회).
  const collected: GroupRecipient[] = [];
  let from = 0;

  while (collected.length < maxRecipients) {
    const to = Math.min(from + CHUNK_SIZE - 1, maxRecipients - 1);

    let q = supabase
      .from("crm_students")
      .select("id, name, parent_phone, status")
      .neq("status", "탈퇴")
      .eq("branch", group.branch);

    // 재원 상태 — count-recipients 와 동일. 빈 배열 default = 탈퇴 빼고 3종 통합.
    // 옛 그룹 JSONB 에 statuses 키가 없으면 빈 배열 → "탈퇴 빼고 전체" 의미 보존.
    const wantedStatuses =
      group.filters.statuses.length > 0
        ? group.filters.statuses
        : ["재원생", "수강이력자", "수강 x"];
    q = q.in("status", wantedStatuses);

    if (group.filters.includeStudentIds.length > 0) {
      q = q.in("id", group.filters.includeStudentIds);
    } else {
      if (group.filters.grades.length > 0) {
        q = q.in("grade", group.filters.grades);
      }
      if (group.filters.schools.length > 0) {
        q = q.in("school", group.filters.schools);
      }
      if (subjectMatchedStudentIds) {
        q = q.in("id", subjectMatchedStudentIds);
      }
      if (allowedSchools) {
        q = q.in("school", allowedSchools);
      }
      // 학교 미등록/등록 토글 — list-group-students 와 동일.
      if (group.filters.unmappedSchool) {
        q = q.or(UNMAPPED_SCHOOL_OR_EXPR) as typeof q;
      } else if (group.filters.mappedSchool) {
        q = applyMappedSchoolFilter(q);
      }
    }

    // 제외 차감(exclude 승리) — include/조건 분기 모두에 적용.
    //   ① excludeStudentIds + excludeClassIds(펼친 student_id) 병합 not.in
    //   ② excludeSchools school not.in
    if (mergedExcludeIds.length > 0) {
      q = q.not("id", "in", `(${mergedExcludeIds.join(",")})`);
    }
    q = applySchoolExclusion(q, excludeSchools);

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
