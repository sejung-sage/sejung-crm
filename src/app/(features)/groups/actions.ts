"use server";

/**
 * F2 · 발송 그룹 Server Actions
 *
 * 공통 정책:
 *   - dev-seed 모드에서는 모든 쓰기 액션이 `{ status: 'dev_seed_mode' }` 로 즉시 반환.
 *     (UI 는 안내 메시지 + 비활성 처리)
 *   - 인증: Supabase Auth getUser. 미로그인 → 실패.
 *   - 권한: users_profile.role ∈ { master, admin } 만 생성/수정/삭제 가능.
 *           manager / viewer 는 조회만 가능 (Server Action 자체가 차단됨).
 *   - 입력 검증: Zod 스키마 재검증 (`CreateGroupInputSchema` 등).
 *   - 성공 시 `revalidatePath('/groups')` 로 목록 재검증.
 *
 * 발송 자체는 F3 (별도 액션). 여기서는 그룹 CRUD 와 recipient_count 유지만 다룸.
 */

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import {
  CreateGroupInputSchema,
  UpdateGroupInputSchema,
  GroupFiltersSchema,
  isValidCustomGroupFilters,
  type CreateGroupInput,
  type UpdateGroupInput,
  type GroupFilters,
} from "@/lib/schemas/group";
import {
  countRecipients,
  diffRecipients,
  type CountRecipientsResult,
  type DiffRecipientsResult,
} from "@/lib/groups/count-recipients";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { GroupRow } from "@/types/database";

// ─── 결과 타입 ──────────────────────────────────────────────

export type CreateGroupActionResult =
  | { status: "success"; id: string }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode" };

export type UpdateGroupActionResult =
  | { status: "success" }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode" };

export type DeleteGroupActionResult =
  | { status: "success" }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode" };

export type DeleteGroupsActionResult =
  | { status: "success"; count: number }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode" };

export type CountRecipientsActionResult =
  | { status: "success"; data: CountRecipientsResult }
  | { status: "failed"; reason: string };

export type DiffRecipientsActionResult =
  | { status: "success"; data: DiffRecipientsResult }
  | { status: "failed"; reason: string };

export type RemoveStudentFromGroupActionResult =
  | { status: "success"; newRecipientCount: number }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode" };

// ─── 권한 가드 ─────────────────────────────────────────────

const WRITE_ROLES = new Set<string>(["master", "admin"]);

type AuthOk = { ok: true; userId: string };
type AuthFail = { ok: false; reason: string };

/**
 * 로그인 + 쓰기 권한(master/admin) 확인.
 * dev-seed 모드는 이 함수 호출 전에 `isDevSeedMode()` 로 분기되어야 함.
 */
async function assertWriteRole(): Promise<AuthOk | AuthFail> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { ok: false, reason: "로그인 후 이용 가능합니다" };
  }

  const { data, error } = await supabase
    .from("crm_users_profile")
    .select("role, active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return { ok: false, reason: "권한 정보 조회에 실패했습니다" };
  }
  if (!data) {
    return { ok: false, reason: "계정 프로필이 없습니다" };
  }
  const profile = data as { role?: string; active?: boolean };
  if (!profile.active) {
    return { ok: false, reason: "비활성 계정은 사용할 수 없습니다" };
  }
  if (!profile.role || !WRITE_ROLES.has(profile.role)) {
    return {
      ok: false,
      reason: "권한이 없습니다 (master / admin 만 가능)",
    };
  }
  return { ok: true, userId: user.id };
}

function zodErrorToReason(err: ZodError): string {
  const first = err.issues[0];
  if (!first) return "입력 값이 올바르지 않습니다";
  return first.message || "입력 값이 올바르지 않습니다";
}

// ─── createGroupAction ─────────────────────────────────────

export async function createGroupAction(
  input: CreateGroupInput,
): Promise<CreateGroupActionResult> {
  if (isDevSeedMode()) {
    return { status: "dev_seed_mode" };
  }

  // 1) 입력 재검증
  let parsed: CreateGroupInput;
  try {
    parsed = CreateGroupInputSchema.parse(input);
  } catch (e) {
    if (e instanceof ZodError) {
      return { status: "failed", reason: zodErrorToReason(e) };
    }
    return { status: "failed", reason: "입력 값이 올바르지 않습니다" };
  }

  // 2) 권한
  const auth = await assertWriteRole();
  if (!auth.ok) {
    return { status: "failed", reason: auth.reason };
  }

  // 3) recipient_count 계산
  let recipientCount = 0;
  try {
    const result = await countRecipients(parsed.filters, parsed.branch);
    recipientCount = result.total;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "수신자 수 계산 실패";
    return { status: "failed", reason: msg };
  }

  // 4) insert
  const supabase = await createSupabaseServerClient();
  // Supabase v2 Database 타입의 Relationships 누락으로 insert payload 가 never
  // 로 추론되는 이슈가 있어 `apply.ts` 와 동일한 전략으로 좁은 cast 사용.
  // 향후 `supabase gen types` 도입 시 제거 예정.
  const insertPayload: Record<string, unknown> = {
    name: parsed.name,
    branch: parsed.branch,
    filters: parsed.filters,
    recipient_count: recipientCount,
    last_sent_at: null,
    last_message_preview: null,
    created_by: auth.userId,
  };
  const { data, error } = await (
    supabase.from("crm_groups") as unknown as {
      insert: (v: Record<string, unknown>) => {
        select: (cols: string) => {
          single: () => Promise<{
            data: { id: string } | null;
            error: { message: string } | null;
          }>;
        };
      };
    }
  )
    .insert(insertPayload)
    .select("id")
    .single();

  if (error) {
    return {
      status: "failed",
      reason: `발송 그룹 생성에 실패했습니다: ${error.message}`,
    };
  }

  if (!data) {
    return { status: "failed", reason: "생성된 그룹 ID 를 읽지 못했습니다" };
  }
  revalidatePath("/groups");
  return { status: "success", id: data.id };
}

// ─── updateGroupAction ─────────────────────────────────────

export async function updateGroupAction(
  input: UpdateGroupInput,
): Promise<UpdateGroupActionResult> {
  if (isDevSeedMode()) {
    return { status: "dev_seed_mode" };
  }

  let parsed: UpdateGroupInput;
  try {
    parsed = UpdateGroupInputSchema.parse(input);
  } catch (e) {
    if (e instanceof ZodError) {
      return { status: "failed", reason: zodErrorToReason(e) };
    }
    return { status: "failed", reason: "입력 값이 올바르지 않습니다" };
  }

  const auth = await assertWriteRole();
  if (!auth.ok) {
    return { status: "failed", reason: auth.reason };
  }

  const supabase = await createSupabaseServerClient();

  // 현재 값이 필요함: filters 가 바뀌면 recipient_count 재계산을 위해,
  // branch 가 바뀌어도 마찬가지.
  const { data: current, error: fetchError } = await supabase
    .from("crm_groups")
    .select("*")
    .eq("id", parsed.id)
    .maybeSingle();

  if (fetchError) {
    return {
      status: "failed",
      reason: `기존 그룹 조회에 실패했습니다: ${fetchError.message}`,
    };
  }
  if (!current) {
    return { status: "failed", reason: "존재하지 않는 그룹입니다" };
  }
  const currentRow = current as GroupRow;

  const nextFilters = parsed.filters ?? currentRow.filters;
  const nextBranch = parsed.branch ?? currentRow.branch;

  // 머지 후 재검증 (2026-05-27 · 그룹 종류 분리).
  //   부분 수정에서 filters 를 빼고 보내면 UpdateGroupInputSchema.refine 가 스킵되므로,
  //   현재 저장값(옛 그룹 JSONB 포함)과 머지된 최종 filters 를 정규화 후 custom 규칙
  //   (kind='custom' → includeStudentIds ≥ 1) 을 단일 술어로 재확인한다.
  //   filters 가 함께 제출된 경우엔 위 parse 에서 이미 한 번 검증되지만, 머지 결과
  //   기준으로 한 번 더 확인해 일관성을 보장한다.
  const mergedFiltersParse = GroupFiltersSchema.safeParse(nextFilters);
  if (!mergedFiltersParse.success) {
    return {
      status: "failed",
      reason: zodErrorToReason(mergedFiltersParse.error),
    };
  }
  const mergedFilters = mergedFiltersParse.data;
  if (!isValidCustomGroupFilters(mergedFilters)) {
    return {
      status: "failed",
      reason: "커스텀 그룹은 학생을 1명 이상 직접 추가해야 합니다",
    };
  }

  const filtersChanged =
    parsed.filters !== undefined || parsed.branch !== undefined;

  type GroupPatch = {
    name?: string;
    branch?: string;
    filters?: GroupRow["filters"];
    recipient_count?: number;
  };
  const patch: GroupPatch = {};
  if (parsed.name !== undefined) patch.name = parsed.name;
  if (parsed.branch !== undefined) patch.branch = parsed.branch;
  if (parsed.filters !== undefined) patch.filters = parsed.filters;

  if (filtersChanged) {
    try {
      const result = await countRecipients(mergedFilters, nextBranch);
      patch.recipient_count = result.total;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "수신자 수 계산 실패";
      return { status: "failed", reason: msg };
    }
  }

  if (Object.keys(patch).length === 0) {
    // 변경 사항 없음 — 성공으로 간주
    return { status: "success" };
  }

  // 동일한 사유로 update 도 좁은 cast.
  const { error: updateError } = await (
    supabase.from("crm_groups") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (
          col: string,
          val: string,
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )
    .update(patch as unknown as Record<string, unknown>)
    .eq("id", parsed.id);

  if (updateError) {
    return {
      status: "failed",
      reason: `발송 그룹 수정에 실패했습니다: ${updateError.message}`,
    };
  }

  revalidatePath("/groups");
  revalidatePath(`/groups/${parsed.id}`);
  return { status: "success" };
}

// ─── deleteGroupAction (단건) ──────────────────────────────

export async function deleteGroupAction(
  id: string,
): Promise<DeleteGroupActionResult> {
  if (isDevSeedMode()) {
    return { status: "dev_seed_mode" };
  }

  if (!id || typeof id !== "string") {
    return { status: "failed", reason: "그룹 ID 가 유효하지 않습니다" };
  }

  const auth = await assertWriteRole();
  if (!auth.ok) {
    return { status: "failed", reason: auth.reason };
  }

  const supabase = await createSupabaseServerClient();
  // campaigns.group_id 는 ON DELETE SET NULL 이므로 기존 캠페인 보존 상태로 삭제됨.
  const { error } = await supabase.from("crm_groups").delete().eq("id", id);

  if (error) {
    return {
      status: "failed",
      reason: `발송 그룹 삭제에 실패했습니다: ${error.message}`,
    };
  }

  revalidatePath("/groups");
  return { status: "success" };
}

// ─── deleteGroupsAction (다건) ─────────────────────────────

export async function deleteGroupsAction(
  ids: string[],
): Promise<DeleteGroupsActionResult> {
  if (isDevSeedMode()) {
    return { status: "dev_seed_mode" };
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    return { status: "failed", reason: "삭제할 그룹이 없습니다" };
  }
  if (ids.some((v) => typeof v !== "string" || v.length === 0)) {
    return { status: "failed", reason: "그룹 ID 목록이 유효하지 않습니다" };
  }

  const auth = await assertWriteRole();
  if (!auth.ok) {
    return { status: "failed", reason: auth.reason };
  }

  const supabase = await createSupabaseServerClient();
  const { error, count } = await supabase
    .from("crm_groups")
    .delete({ count: "exact" })
    .in("id", ids);

  if (error) {
    return {
      status: "failed",
      reason: `발송 그룹 일괄 삭제에 실패했습니다: ${error.message}`,
    };
  }

  revalidatePath("/groups");
  return { status: "success", count: count ?? 0 };
}

// ─── countRecipientsAction ─────────────────────────────────
// UI 의 세그먼트 빌더에서 디바운스(300ms) 로 호출되는 경량 액션.
// 쓰기 권한 검사 없이 누구나 카운트는 조회 가능 (조회 전용).
// dev-seed 모드에서도 정상 동작.

export async function countRecipientsAction(
  filters: unknown,
  branch: unknown,
): Promise<CountRecipientsActionResult> {
  let parsedFilters: GroupFilters;
  try {
    parsedFilters = GroupFiltersSchema.parse(filters);
  } catch (e) {
    if (e instanceof ZodError) {
      return { status: "failed", reason: zodErrorToReason(e) };
    }
    return { status: "failed", reason: "필터 값이 올바르지 않습니다" };
  }
  if (typeof branch !== "string" || branch.trim().length === 0) {
    return { status: "failed", reason: "분원은 필수입니다" };
  }

  try {
    const result = await countRecipients(parsedFilters, branch.trim());
    return { status: "success", data: result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "수신자 수 계산 실패";
    return { status: "failed", reason: msg };
  }
}

// ─── groupBuilderFilterOptionsAction ──────────────────────
// 그룹 빌더의 학교/학년/지역 칩 옵션을 statuses 등 다른 칩 토글에 맞춰 좁힘.
// listStudentFilterOptions 의 client 노출 래퍼 — RLS 통과 위해 server.

import {
  listStudentFilterOptions,
  type StudentFilterOptions,
} from "@/lib/profile/list-filter-options";
import type { StudentStatus } from "@/types/database";

export type GroupBuilderFilterOptionsResult =
  | { status: "success"; data: StudentFilterOptions }
  | { status: "failed"; reason: string };

export async function groupBuilderFilterOptionsAction(
  branch: unknown,
  statuses: unknown,
): Promise<GroupBuilderFilterOptionsResult> {
  if (typeof branch !== "string") {
    return { status: "failed", reason: "분원 값이 올바르지 않습니다" };
  }
  const allowedStatuses: StudentStatus[] = ["재원생", "수강이력자", "수강 x"];
  const cleanStatuses = Array.isArray(statuses)
    ? statuses.filter((s): s is StudentStatus =>
        typeof s === "string" &&
        (allowedStatuses as ReadonlyArray<string>).includes(s),
      )
    : [];

  try {
    const data = await listStudentFilterOptions({
      branch: branch || undefined,
      statuses: cleanStatuses,
      // 그룹은 졸업·미정 학생도 발송 대상 가능.
      includeHidden: true,
    });
    return { status: "success", data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "필터 옵션 조회 실패";
    return { status: "failed", reason: msg };
  }
}

// ─── searchStudentsAction ─────────────────────────────────
// 그룹 빌더의 "직접 학생 추가" 검색용. 이름 또는 학부모 연락처 부분일치.
// 분원 필수 (다른 분원 학생 노출 방지). 조회 전용이므로 권한 가드 없음.

import { searchStudentsForGroup, type StudentSearchHit } from "@/lib/profile/search-students-for-group";

export type SearchStudentsActionResult =
  | { status: "success"; data: StudentSearchHit[] }
  | { status: "failed"; reason: string };

export async function searchStudentsAction(
  query: unknown,
  branch: unknown,
): Promise<SearchStudentsActionResult> {
  if (typeof query !== "string") {
    return { status: "failed", reason: "검색어가 올바르지 않습니다" };
  }
  if (typeof branch !== "string" || branch.trim().length === 0) {
    return { status: "failed", reason: "분원은 필수입니다" };
  }
  try {
    const hits = await searchStudentsForGroup(query, branch.trim());
    return { status: "success", data: hits };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "학생 검색 실패";
    return { status: "failed", reason: msg };
  }
}

// ─── listClassOptionsAction ───────────────────────────────
// 그룹 빌더의 "강좌별 제외" 드롭다운 옵션을 분원 변경 시 재페치.
// 초기값은 페이지(new/edit)가 prop 으로 내려주고, master 가 분원 칩을 바꾸면
// 이 액션으로 새 분원의 강좌 목록을 다시 가져온다. 조회 전용 — 권한 가드 없음.

import { listClassOptions, type ClassOption } from "@/lib/classes/list-class-options";

export type ListClassOptionsResult =
  | { status: "success"; data: ClassOption[] }
  | { status: "failed"; reason: string };

export async function listClassOptionsAction(
  branch: unknown,
): Promise<ListClassOptionsResult> {
  if (typeof branch !== "string" || branch.trim().length === 0) {
    return { status: "failed", reason: "분원은 필수입니다" };
  }
  try {
    const data = await listClassOptions(branch.trim());
    return { status: "success", data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "강좌 목록 조회 실패";
    return { status: "failed", reason: msg };
  }
}

// ─── diffRecipientsAction ──────────────────────────────────
// 그룹 수정 폼에서 필터를 바꿨을 때 "추가 N명 / 제거 M명" 미리보기 용.
// 조회 전용 — 쓰기 권한 가드 없음 (필터값 자체는 민감하지 않음).

export async function diffRecipientsAction(
  oldFiltersInput: unknown,
  newFiltersInput: unknown,
  branch: unknown,
): Promise<DiffRecipientsActionResult> {
  let parsedOld: GroupFilters;
  let parsedNew: GroupFilters;
  try {
    parsedOld = GroupFiltersSchema.parse(oldFiltersInput);
    parsedNew = GroupFiltersSchema.parse(newFiltersInput);
  } catch (e) {
    if (e instanceof ZodError) {
      return { status: "failed", reason: zodErrorToReason(e) };
    }
    return { status: "failed", reason: "필터 값이 올바르지 않습니다" };
  }
  if (typeof branch !== "string" || branch.trim().length === 0) {
    return { status: "failed", reason: "분원은 필수입니다" };
  }
  try {
    const data = await diffRecipients(parsedOld, parsedNew, branch.trim());
    return { status: "success", data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "수신자 변경 미리보기 실패";
    return { status: "failed", reason: msg };
  }
}

// ─── removeStudentFromGroupAction ──────────────────────────
// 그룹 상세에서 특정 학생을 그룹에서 제외(건별 삭제).
//   - includeStudentIds 에 박혀 있던 학생이면 그 배열에서 제거
//   - 그 외 (조건 매칭으로 들어온 학생) 면 excludeStudentIds 에 적재
// 재계산된 recipient_count 도 함께 저장. 권한: master/admin 본인 분원.

export async function removeStudentFromGroupAction(
  groupId: unknown,
  studentId: unknown,
): Promise<RemoveStudentFromGroupActionResult> {
  if (isDevSeedMode()) {
    return { status: "dev_seed_mode" };
  }

  if (typeof groupId !== "string" || groupId.length === 0) {
    return { status: "failed", reason: "그룹 ID 가 유효하지 않습니다" };
  }
  if (typeof studentId !== "string" || studentId.length === 0) {
    return { status: "failed", reason: "학생 ID 가 유효하지 않습니다" };
  }

  const auth = await assertWriteRole();
  if (!auth.ok) {
    return { status: "failed", reason: auth.reason };
  }

  const supabase = await createSupabaseServerClient();

  // 현재 그룹 + 필터 로드.
  const { data: current, error: fetchError } = await supabase
    .from("crm_groups")
    .select("*")
    .eq("id", groupId)
    .maybeSingle();
  if (fetchError) {
    return {
      status: "failed",
      reason: `기존 그룹 조회에 실패했습니다: ${fetchError.message}`,
    };
  }
  if (!current) {
    return { status: "failed", reason: "존재하지 않는 그룹입니다" };
  }
  const currentRow = current as GroupRow;

  // 필터 정규화 (옛 그룹 JSONB 호환).
  const parsedFilters = GroupFiltersSchema.safeParse(currentRow.filters);
  if (!parsedFilters.success) {
    return { status: "failed", reason: "그룹 필터 구조가 깨졌습니다" };
  }
  const filters = parsedFilters.data;

  // 다음 필터 계산: includeStudentIds 에 있으면 거기서 제거, 아니면 excludeStudentIds 적재.
  let nextFilters: GroupFilters;
  if (filters.includeStudentIds.includes(studentId)) {
    nextFilters = {
      ...filters,
      includeStudentIds: filters.includeStudentIds.filter(
        (id) => id !== studentId,
      ),
    };
  } else {
    if (filters.excludeStudentIds.includes(studentId)) {
      // 이미 제외 상태 — recipient_count 만 재계산하고 성공 처리.
      const recount = await countRecipients(filters, currentRow.branch);
      return { status: "success", newRecipientCount: recount.total };
    }
    nextFilters = {
      ...filters,
      excludeStudentIds: [...filters.excludeStudentIds, studentId],
    };
  }

  // 머지 후 재검증 (2026-05-27 · 그룹 종류 분리). custom 그룹에서 마지막 1명을 빼
  //   includeStudentIds 가 비면 "아무에게도 안 가는 빈 커스텀 그룹" 이 되므로 차단.
  //   isValidCustomGroupFilters 단일 술어 — filter 그룹엔 영향 없음.
  if (!isValidCustomGroupFilters(nextFilters)) {
    return {
      status: "failed",
      reason: "커스텀 그룹은 학생을 1명 이상 직접 추가해야 합니다",
    };
  }

  // recipient_count 재계산 (UI 캐시 동기화).
  let newRecipientCount = 0;
  try {
    const recount = await countRecipients(nextFilters, currentRow.branch);
    newRecipientCount = recount.total;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "수신자 수 재계산 실패";
    return { status: "failed", reason: msg };
  }

  type GroupPatch = {
    filters: GroupRow["filters"];
    recipient_count: number;
  };
  const patch: GroupPatch = {
    filters: nextFilters,
    recipient_count: newRecipientCount,
  };
  const { error: updateError } = await (
    supabase.from("crm_groups") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (col: string, val: string) => Promise<{
          error: { message: string } | null;
        }>;
      };
    }
  )
    .update(patch as unknown as Record<string, unknown>)
    .eq("id", groupId);

  if (updateError) {
    return {
      status: "failed",
      reason: `그룹에서 학생 제외에 실패했습니다: ${updateError.message}`,
    };
  }

  revalidatePath("/groups");
  revalidatePath(`/groups/${groupId}`);
  return { status: "success", newRecipientCount };
}
