"use server";

/**
 * 학교 → 지역 매핑 admin Server Actions.
 *
 * 정책:
 *   - dev-seed 모드: 조회는 정적 시드, 쓰기는 즉시 `dev_seed_mode` 반환.
 *   - 인증: Supabase Auth getUser. 미로그인 → 실패.
 *   - 권한: users_profile.role ∈ { master, admin } 만 쓰기 가능.
 *           manager / viewer 는 actions 자체가 차단됨 (admin UI 진입도 안 됨).
 *   - 입력 검증: SchoolRegionUpsertSchema 재검증.
 *   - 성공 시 revalidatePath:
 *       /regions  — 매핑 표 자체
 *       /students — 학생 region 도 함께 바뀌므로 리스트 캐시 무효화
 *
 * RLS 가 2차 방어. 본 파일은 1차 방어 (실패 시 RLS 까지 가지 않고 즉시 차단).
 */

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import {
  SchoolRegionUpsertSchema,
  type SchoolRegionUpsert,
} from "@/lib/schemas/region";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  listSchoolRegions,
  type ListSchoolRegionsQuery,
} from "@/lib/regions/list-school-regions";
import {
  upsertSchoolRegion,
  DevSeedReadOnlyError,
} from "@/lib/regions/upsert-school-region";
import { deleteSchoolRegion } from "@/lib/regions/delete-school-region";
import {
  listMissingSchoolRegions,
  type MissingSchoolsResult,
} from "@/lib/regions/list-missing-regions";
import type { SchoolRegionRow } from "@/types/database";

// ─── 결과 타입 ──────────────────────────────────────────────

export type ListSchoolRegionsActionResult =
  | { status: "success"; data: SchoolRegionRow[] }
  | { status: "failed"; reason: string };

export type UpsertSchoolRegionActionResult =
  | { status: "success"; data: SchoolRegionRow }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode" };

export type DeleteSchoolRegionActionResult =
  | { status: "success" }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode" };

export type ListMissingSchoolRegionsActionResult =
  | { status: "success"; data: MissingSchoolsResult }
  | { status: "failed"; reason: string };

// ─── 권한 가드 ─────────────────────────────────────────────
//
// students/actions.ts · groups/actions.ts 와 완전 동일한 패턴.
// can() 헬퍼는 Resource enum 에 'region' 이 없어 사용하지 않고,
// role 화이트리스트로 직접 검증 (school_regions RLS 정책과 일치: master/admin).

const WRITE_ROLES = new Set<string>(["master", "admin"]);

type AuthOk = { ok: true; userId: string };
type AuthFail = { ok: false; reason: string };

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
    return { ok: false, reason: "권한 확인에 실패했습니다" };
  }
  if (!data) {
    return { ok: false, reason: "계정 프로필이 없습니다" };
  }
  // Supabase v2 Database 타입 추론 한계 — 좁은 캐스팅.
  const profile = data as { role?: string; active?: boolean };
  if (!profile.active) {
    return { ok: false, reason: "비활성 계정입니다" };
  }
  if (!profile.role || !WRITE_ROLES.has(profile.role)) {
    return {
      ok: false,
      reason: "지역 매핑 권한이 없습니다 (master/admin 만)",
    };
  }
  return { ok: true, userId: user.id };
}

// ─── Actions ────────────────────────────────────────────────

/**
 * 매핑 리스트 조회. 읽기 전용이라 권한 가드 없이 RLS(SELECT)에 위임.
 * 실패는 reason 으로 감싸 UI 가 빈 표 fallback 을 결정할 수 있게.
 */
export async function listSchoolRegionsAction(
  query?: ListSchoolRegionsQuery,
): Promise<ListSchoolRegionsActionResult> {
  try {
    const data = await listSchoolRegions(query);
    return { status: "success", data };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "지역 매핑 조회 실패";
    return { status: "failed", reason };
  }
}

/**
 * 매핑 누락 학교 리스트 조회 (admin 미매핑 섹션).
 */
export async function listMissingSchoolRegionsAction(): Promise<ListMissingSchoolRegionsActionResult> {
  try {
    const data = await listMissingSchoolRegions();
    return { status: "success", data };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "매핑 누락 학교 조회 실패";
    return { status: "failed", reason };
  }
}

/**
 * 매핑 Upsert (생성 또는 수정).
 * UI 에서는 "추가" 버튼과 "수정" 버튼이 모두 이 액션을 호출 — onConflict 로 멱등.
 */
export async function upsertSchoolRegionAction(
  input: SchoolRegionUpsert,
): Promise<UpsertSchoolRegionActionResult> {
  if (isDevSeedMode()) {
    return { status: "dev_seed_mode" };
  }

  const auth = await assertWriteRole();
  if (!auth.ok) {
    return { status: "failed", reason: auth.reason };
  }

  let parsed: SchoolRegionUpsert;
  try {
    parsed = SchoolRegionUpsertSchema.parse(input);
  } catch (e) {
    if (e instanceof ZodError) {
      const first = e.issues[0];
      return {
        status: "failed",
        reason: first?.message ?? "입력값이 올바르지 않습니다",
      };
    }
    return { status: "failed", reason: "입력값 검증에 실패했습니다" };
  }

  try {
    const data = await upsertSchoolRegion(parsed);
    revalidatePath("/regions");
    revalidatePath("/students"); // 학생 region 도 함께 바뀌므로 리스트 캐시 무효화
    return { status: "success", data };
  } catch (e) {
    if (e instanceof DevSeedReadOnlyError) {
      return { status: "dev_seed_mode" };
    }
    const reason = e instanceof Error ? e.message : "지역 매핑 저장 실패";
    return { status: "failed", reason };
  }
}

/**
 * 매핑 단건 삭제.
 * 삭제된 학교의 학생들은 region='기타' 로 자동 fallback (뷰의 COALESCE).
 */
export async function deleteSchoolRegionAction(
  school: string,
): Promise<DeleteSchoolRegionActionResult> {
  if (isDevSeedMode()) {
    return { status: "dev_seed_mode" };
  }

  const auth = await assertWriteRole();
  if (!auth.ok) {
    return { status: "failed", reason: auth.reason };
  }

  const trimmed = school.trim();
  if (trimmed.length === 0) {
    return { status: "failed", reason: "학교명이 비어있습니다" };
  }

  try {
    await deleteSchoolRegion(trimmed);
    revalidatePath("/regions");
    revalidatePath("/students");
    return { status: "success" };
  } catch (e) {
    if (e instanceof DevSeedReadOnlyError) {
      return { status: "dev_seed_mode" };
    }
    const reason = e instanceof Error ? e.message : "지역 매핑 삭제 실패";
    return { status: "failed", reason };
  }
}
