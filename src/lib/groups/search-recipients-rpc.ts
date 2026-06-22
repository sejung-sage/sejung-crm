/**
 * search_recipients RPC(0093) 공용 호출 헬퍼.
 *
 * 미리보기(preview-recipients)와 발송 로더(load-all-group-recipients)가 학생 ID·제외
 * 목록을 PostgREST GET URL 에 `.in()` / `.not.in()` 으로 직렬화하면, 목록이 수천 건이면
 * URL 길이 한도를 넘어 Cloudflare 414 로 죽는다. 이 RPC 는 모든 필터값과 ID 배열을
 * "요청 본문(POST)" 으로 받아 서버에서 매칭하므로 414 가 발생하지 않는다.
 *
 * 필터 → 파라미터 매핑은 count-recipients / load-all-group-recipients 의 기존 시맨틱과
 * 동일하게 맞춘다(아래 buildSearchRecipientsParams 주석 참조). 미리보기와 발송이 이 한
 * 함수를 공유하므로 "미리보기 인원 = 실제 발송 인원" 이 구조적으로 일치한다.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GroupFilters } from "@/lib/schemas/group";
import { isCustomGroup } from "@/lib/schemas/group";
import { isAllSubjects } from "@/lib/schemas/common";

/** RPC 한 행. total_count 는 윈도우 카운트(매칭 전체 수) — 모든 행이 동일 값. */
export interface SearchRecipientRow {
  id: string;
  name: string;
  parent_phone: string | null;
  phone: string | null;
  status: string;
  total_count: number;
}

/** search_recipients 의 필터 파라미터(offset/limit 제외). */
export interface SearchRecipientsParams {
  p_branch: string;
  p_grades: string[] | null;
  p_schools: string[] | null;
  p_regions: string[] | null;
  p_subjects: string[] | null;
  p_statuses: string[] | null;
  p_mapped_school: boolean;
  p_unmapped_school: boolean;
  p_include_ids: string[] | null;
  p_exclude_ids: string[] | null;
  p_exclude_schools: string[] | null;
  p_exclude_class_ids: string[] | null;
  p_require_parent_phone: boolean;
}

/** 빈 배열은 null 로 (RPC 측 "필터 미적용"). */
function nullIfEmpty(arr: readonly string[] | null | undefined): string[] | null {
  return arr && arr.length > 0 ? [...arr] : null;
}

/**
 * GroupFilters → search_recipients 파라미터.
 *
 * 시맨틱(기존 경로 보존):
 *   - custom(고정 명단): includeStudentIds 가 모집단. 조건(grades/schools/regions/
 *     subjects/학교제외/강좌제외/학교등록토글)은 무시하고 excludeStudentIds 차감만 유지.
 *   - filter(조건): includeStudentIds 무시. 조건 + 제외 3종 적용.
 *   - subjects 7종 전체/빈 배열 = "조건 없음"(NULL) 정규화(isAllSubjects).
 *   - status 빈 배열 = "탈퇴 빼고 전체"(RPC 측 default). 탈퇴는 항상 제외.
 *
 * @param requireParentPhone 미리보기 eligible/샘플은 학부모 번호 필수(true). 발송 로더는
 *   학생 레그도 있어 false (parent_phone NULL 행도 받아 호출자가 레그 확장).
 */
export function buildSearchRecipientsParams(
  filters: GroupFilters,
  branch: string,
  requireParentPhone: boolean,
): SearchRecipientsParams {
  const custom = isCustomGroup(filters);

  const subjects =
    !custom &&
    filters.subjects.length > 0 &&
    !isAllSubjects(filters.subjects)
      ? [...filters.subjects]
      : null;

  return {
    p_branch: branch,
    p_grades: custom ? null : nullIfEmpty(filters.grades),
    p_schools: custom ? null : nullIfEmpty(filters.schools),
    p_regions: custom ? null : nullIfEmpty(filters.regions),
    p_subjects: subjects,
    // status 가드는 custom·filter 공통(탈퇴 제외 + 선택 상태). 빈 배열 → RPC default.
    p_statuses: nullIfEmpty(filters.statuses),
    p_mapped_school: custom ? false : !!filters.mappedSchool,
    p_unmapped_school: custom ? false : !!filters.unmappedSchool,
    p_include_ids: custom ? nullIfEmpty(filters.includeStudentIds) : null,
    p_exclude_ids: nullIfEmpty(filters.excludeStudentIds),
    p_exclude_schools: custom ? null : nullIfEmpty(filters.excludeSchools),
    p_exclude_class_ids: custom ? null : nullIfEmpty(filters.excludeClassIds),
    p_require_parent_phone: requireParentPhone,
  };
}

/**
 * search_recipients 1회 호출. 정렬(registered_at DESC NULLS LAST, id) 후 offset/limit
 * 구간 행 + total_count(매칭 전체 수)를 반환.
 *
 * 주의: limit 는 PostgREST `max_rows`(1,000) 이하로. 전량 로드는 호출자가 offset 페이징.
 */
export async function callSearchRecipients(
  supabase: SupabaseClient,
  params: SearchRecipientsParams,
  offset: number,
  limit: number,
): Promise<{ rows: SearchRecipientRow[]; total: number }> {
  const { data, error } = await (
    supabase.rpc as unknown as (
      fn: "search_recipients",
      p: SearchRecipientsParams & { p_offset: number; p_limit: number },
    ) => Promise<{
      data: SearchRecipientRow[] | null;
      error: { message: string } | null;
    }>
  )("search_recipients", { ...params, p_offset: offset, p_limit: limit });

  if (error) {
    throw new Error(`수신자 조회에 실패했습니다: ${error.message}`);
  }
  const rows = data ?? [];
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
  return { rows, total };
}
