/**
 * 발송용 수신자 전체 일괄 로더.
 *
 * 기존 `listGroupStudents` 는 50건/페이지로 페이지네이션 + 페이지마다 head 카운트 +
 * unsubscribes 쿼리를 반복했다. 60K 수신자 발송 시 페이지당 4 쿼리 × 1,200 페이지 =
 * 약 5,000 라운드트립으로 Server Action 300s 타임아웃을 초과했다.
 *
 * 본 함수는 발송 큐 적재 직전 eligible 재조회 전용. 다음을 보장한다:
 *   - getGroup 1회만 호출
 *   - crm_students 직접 청크 range 페치 (view 풀집계 우회 — count-recipients 와
 *     동일 패턴. subjects/regions 사전 매핑으로 좁힘)
 *   - 60K 기준 약 61 쿼리 (1 + 60)
 *
 * 레그 모델 (0077): parent_phone·phone 두 번호를 모두 SELECT 해 반환한다.
 *   발송 대상 번호 선택(학부모/학생) 레그 확장은 호출자(`expandRecipientLegs`)가
 *   수행한다. 수신거부 제외도 "레그별 번호" 기준이라 호출자 책임으로 이동했다 —
 *   본 함수는 더 이상 parent_phone 기준으로 수신거부를 걸지 않는다(학부모 번호
 *   수신거부가 학생 번호 레그를 죽이면 안 되기 때문). 탈퇴 학생은 기존대로 행
 *   자체를 SQL 단에서 제외(status='탈퇴' neq, 레그 무관).
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
 *   - 분원·탈퇴 가드 항상 적용 (수신거부는 레그별로 호출자가 적용)
 *
 * 호출자는 Supabase 클라이언트를 주입한다 — Server Action 은 server 클라이언트,
 * cron 디스패처는 service 클라이언트를 사용.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getGroup } from "./get-group";
import { isCustomGroup } from "@/lib/schemas/group";
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
  /** 학부모 대표번호. 학부모 레그 후보. NULL 이면 학부모 레그 스킵. */
  parent_phone: string | null;
  /** 학생 개인번호. 학생 레그 후보. NULL 이면 학생 레그 스킵. (0077) */
  phone: string | null;
  status: StudentStatus;
}

export async function loadAllGroupRecipients(
  supabase: SupabaseClient<Database>,
  groupId: string,
  maxRecipients: number,
): Promise<GroupRecipient[]> {
  const group = await getGroup(groupId);
  if (!group) return [];

  // 그룹 종류 분기 (2026-05-27) — isCustomGroup 술어 경유.
  // custom: includeStudentIds 모집단(필터/excludeSchools/excludeClassIds 무시),
  //         excludeStudentIds 차감만 유지.
  // filter: 조건 모집단(includeStudentIds 무시), exclude 3종 차감.
  const custom = isCustomGroup(group.filters);

  // 1.5) custom 인데 명단이 비면 모집단 0명 → 즉시 빈 결과.
  if (custom && group.filters.includeStudentIds.length === 0) {
    return [];
  }

  // 2) (filter 전용) subjects 사전 매핑 — count-recipients 와 동일 정책.
  //    ETL 상 enrollments.subject 는 NULL → classes.subject 로 두 단계 매핑.
  //    7종 전체 체크 = "조건 없음" 으로 정규화. custom 은 subjects 무시.
  let subjectMatchedStudentIds: string[] | null = null;
  if (
    !custom &&
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

  // 3) (filter 전용) regions 사전 매핑 — crm_school_regions 에서 매칭 school 페치.
  //    custom 은 regions 조건 무시.
  let allowedSchools: string[] | null = null;
  if (!custom && group.filters.regions.length > 0) {
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

  // 3.5) (filter 전용) 강좌별 제외 사전 페치 — excludeClassIds(crm_classes.id) →
  //      aca_class_id → crm_enrollments 매칭 student_id. 강좌 수가 적어 1회성 페치.
  //      custom 그룹은 excludeClassIds 무시.
  const excludeClassStudentIds = custom
    ? []
    : await loadExcludedClassStudentIds(
        supabase,
        group.filters.excludeClassIds ?? [],
      );
  // 명시 제외(excludeStudentIds) + (filter 한정)강좌 제외 펼침을 not.in uuid 목록 병합.
  // custom 도 excludeStudentIds 차감은 유지(개별 제거).
  const mergedExcludeIds = mergeExcludedStudentIds(
    group.filters.excludeStudentIds ?? [],
    excludeClassStudentIds,
  );
  // 학교별 제외는 filter 전용. custom 은 excludeSchools 무시.
  const excludeSchools = custom ? [] : (group.filters.excludeSchools ?? []);

  // 4) crm_students 직접 청크 range 페치 (view 풀집계 우회).
  const collected: GroupRecipient[] = [];
  let from = 0;

  while (collected.length < maxRecipients) {
    const to = Math.min(from + CHUNK_SIZE - 1, maxRecipients - 1);

    let q = supabase
      .from("crm_students")
      .select("id, name, parent_phone, phone, status")
      .neq("status", "탈퇴");
    // custom(고정 명단) 그룹은 분원 필터를 적용하지 않는다 — 운영자가 직접 담은
    // 학생은 타 분원(예: 본사 테스트용)이라도 발송 대상에 포함. count-recipients 와
    // 동일 규칙이라 미리보기 수 = 실제 발송 수. 접근은 RLS 가 보장.
    if (!custom) {
      q = q.eq("branch", group.branch);
    }

    // 재원 상태 — count-recipients 와 동일. 빈 배열 default = 탈퇴 빼고 3종 통합.
    // 옛 그룹 JSONB 에 statuses 키가 없으면 빈 배열 → "탈퇴 빼고 전체" 의미 보존.
    const wantedStatuses =
      group.filters.statuses.length > 0
        ? group.filters.statuses
        : ["재원생", "수강이력자", "수강 x"];
    q = q.in("status", wantedStatuses);

    if (custom) {
      // custom(고정 명단): includeStudentIds 모집단만. 필터 조건 무시.
      q = q.in("id", group.filters.includeStudentIds);
    } else {
      // filter(조건 동기화): 조건 매치. includeStudentIds 무시.
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

    // 수신거부 제외는 더 이상 SQL 단(parent_phone 기준)에서 하지 않는다.
    // 레그 확장(0077) 후 "레그별 번호" 기준으로 호출자(expandRecipientLegs)가
    // 독립 판정한다 — 학부모 번호 수신거부가 학생 번호 레그를 죽이면 안 되기 때문.

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
