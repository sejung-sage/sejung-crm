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
import type { GroupFilters } from "@/lib/schemas/group";
import type { Database, StudentStatus } from "@/types/database";
import {
  buildSearchRecipientsParams,
  callSearchRecipients,
} from "./search-recipients-rpc";

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
  return loadRecipientsByFilters(
    supabase,
    group.filters,
    group.branch,
    maxRecipients,
  );
}

/**
 * 그룹(crm_groups) 없이 (filters, branch) 만으로 발송 수신자를 일괄 로드한다.
 * `loadAllGroupRecipients` 본문에서 추출 — 동작 100% 동일. "그룹 없이 필터로
 * 직접 발송" 경로(Phase 1)에서 호출한다.
 */
export async function loadRecipientsByFilters(
  supabase: SupabaseClient<Database>,
  filters: GroupFilters,
  branch: string,
  maxRecipients: number,
): Promise<GroupRecipient[]> {
  // custom(고정 명단)인데 명단이 비면 모집단 0명 → 즉시 빈 결과.
  if (isCustomGroup(filters) && filters.includeStudentIds.length === 0) {
    return [];
  }

  // 모든 필터값·ID 배열을 "요청 본문" 으로 넘기는 search_recipients RPC(0093)로 조회한다.
  // 과거엔 subjects→학생ID / excludeStudentIds(체크해제) / 강좌제외 펼침을 .in()·.not.in()
  // 으로 GET URL 에 직렬화해, 목록이 수천 건이면 Cloudflare 414(URI Too Large)로 발송이
  // 죽었다. RPC 는 subjects/regions/제외 3종/custom 모집단을 서버에서 매칭하므로 안전하다.
  //
  // 발송 로더라 학생 레그(0077)용으로 parent_phone NULL 행도 받아야 한다
  // → require_parent_phone=false. 수신거부 제외는 종전대로 호출자(expandRecipientLegs)가
  // "레그별 번호" 기준으로 적용한다(여기선 미적용).
  const params = buildSearchRecipientsParams(filters, branch, false);

  const collected: GroupRecipient[] = [];
  let offset = 0;
  while (collected.length < maxRecipients) {
    // CHUNK_SIZE 는 PostgREST max_rows(1,000) 이하 — RPC 반환도 동일 cap 이라 offset 페이징.
    const limit = Math.min(CHUNK_SIZE, maxRecipients - collected.length);
    const { rows } = await callSearchRecipients(supabase, params, offset, limit);

    for (const r of rows) {
      collected.push({
        id: r.id,
        name: r.name,
        parent_phone: r.parent_phone,
        phone: r.phone,
        status: r.status as StudentStatus,
      });
    }

    // 받은 행이 요청 limit 보다 적으면 소스 소진 → 종료.
    if (rows.length < limit) break;
    offset += rows.length;
  }

  return collected;
}
