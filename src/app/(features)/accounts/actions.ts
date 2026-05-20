"use server";

/**
 * F4 · 계정 관리 Server Actions
 *
 * 정책:
 *   - 모든 액션 dev-seed 모드 → `{ status:'dev_seed_mode' }` 즉시 반환.
 *   - 권한 가드: 모든 계정 액션은 master 전용.
 *     · master  : 전 분원 계정 관리.
 *     · 그 외   : 거부.
 *   - 계정 생성: Supabase Admin API `inviteUserByEmail` 사용.
 *     → auth.users 행 생성 + 임시 비밀번호 설정 메일 발송.
 *     → 반환된 user.id 로 users_profile INSERT (must_change_password=true).
 *   - 계정 수정:
 *     · role/branch 모두 master 가 자유롭게 변경.
 *   - 자기 자신 비활성화/role 강등 금지.
 */

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import {
  CreateAccountInputSchema,
  UpdateAccountInputSchema,
  type CreateAccountInput,
  type UpdateAccountInput,
} from "@/lib/schemas/auth";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { CurrentUser, UserProfileRow } from "@/types/database";

// ─── 결과 타입 ──────────────────────────────────────────────

export type CreateAccountActionResult =
  | { status: "success"; userId: string }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode" };

export type UpdateAccountActionResult =
  | { status: "success" }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode" };

export type DeactivateAccountActionResult =
  | { status: "success" }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode" };

export type ReactivateAccountActionResult =
  | { status: "success" }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode" };

// ─── 내부 유틸 ─────────────────────────────────────────────

function zodErrorToReason(err: ZodError): string {
  const first = err.issues[0];
  if (!first) return "입력 값이 올바르지 않습니다";
  return first.message || "입력 값이 올바르지 않습니다";
}

async function requireCurrentUser(): Promise<
  { ok: true; user: CurrentUser } | { ok: false; reason: string }
> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, reason: "로그인 후 이용 가능합니다" };
  }
  return { ok: true, user };
}

/**
 * master 전용 가드. 로그인 + role === 'master' + active 확인.
 */
function requireMaster(user: CurrentUser): { ok: true } | { ok: false; reason: string } {
  if (!user.active) {
    return { ok: false, reason: "비활성화된 계정입니다" };
  }
  if (user.role !== "master") {
    return { ok: false, reason: "마스터만 접근할 수 있습니다" };
  }
  return { ok: true };
}

/**
 * 대상 사용자 프로필 조회. master 만 호출하므로 branch 검사 불필요.
 */
async function loadTargetProfile(
  targetUserId: string,
): Promise<
  { ok: true; profile: UserProfileRow } | { ok: false; reason: string }
> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("crm_users_profile")
    .select("*")
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (error) {
    return { ok: false, reason: "대상 계정 조회에 실패했습니다" };
  }
  if (!data) {
    return { ok: false, reason: "존재하지 않는 계정입니다" };
  }
  const profile = data as UserProfileRow;
  return { ok: true, profile };
}

// ─── createAccountAction ──────────────────────────────────

export async function createAccountAction(
  input: CreateAccountInput,
): Promise<CreateAccountActionResult> {
  if (isDevSeedMode()) {
    return { status: "dev_seed_mode" };
  }

  // 1) Zod
  const parsed = CreateAccountInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "failed", reason: zodErrorToReason(parsed.error) };
  }
  const payload = parsed.data;

  // 2) 현재 사용자
  const cur = await requireCurrentUser();
  if (!cur.ok) return { status: "failed", reason: cur.reason };

  // 3) 권한 가드 (master 전용)
  const guard = requireMaster(cur.user);
  if (!guard.ok) {
    return { status: "failed", reason: guard.reason };
  }

  // 5) Service role 로 invite
  const svc = createSupabaseServiceClient();
  const { data, error } = await svc.auth.admin.inviteUserByEmail(payload.email);

  if (error || !data.user) {
    // Supabase 가 반환하는 message 를 그대로 노출하지 않고 사례별 한글화.
    const msg = (error?.message ?? "").toLowerCase();
    if (msg.includes("already") || msg.includes("registered")) {
      return { status: "failed", reason: "이미 등록된 이메일입니다" };
    }
    if (msg.includes("rate")) {
      return {
        status: "failed",
        reason: "초대 메일 발송이 잠시 제한되었습니다. 잠시 후 다시 시도하세요",
      };
    }
    return {
      status: "failed",
      reason: `계정 생성에 실패했습니다: ${error?.message ?? "알 수 없는 오류"}`,
    };
  }

  const newUserId = data.user.id;

  // 6) users_profile INSERT
  const insertPayload: Record<string, unknown> = {
    user_id: newUserId,
    name: payload.name,
    email: payload.email,
    role: payload.role,
    branch: payload.branch,
    active: true,
    must_change_password: true,
  };

  const { error: insertErr } = await (
    svc.from("crm_users_profile") as unknown as {
      insert: (v: Record<string, unknown>) => Promise<{
        error: { message: string } | null;
      }>;
    }
  ).insert(insertPayload);

  if (insertErr) {
    // 보상: 방금 만든 auth.users 정리(무한 잔여 invite 방지)
    try {
      await svc.auth.admin.deleteUser(newUserId);
    } catch {
      /* noop — 다음 정리 작업으로 회수 */
    }
    return {
      status: "failed",
      reason: `프로필 생성에 실패했습니다: ${insertErr.message}`,
    };
  }

  revalidatePath("/accounts");
  return { status: "success", userId: newUserId };
}

// ─── updateAccountAction ──────────────────────────────────

export async function updateAccountAction(
  input: UpdateAccountInput,
): Promise<UpdateAccountActionResult> {
  if (isDevSeedMode()) {
    return { status: "dev_seed_mode" };
  }

  const parsed = UpdateAccountInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "failed", reason: zodErrorToReason(parsed.error) };
  }
  const payload = parsed.data;

  const cur = await requireCurrentUser();
  if (!cur.ok) return { status: "failed", reason: cur.reason };

  // 권한 가드 (master 전용)
  const guard = requireMaster(cur.user);
  if (!guard.ok) {
    return { status: "failed", reason: guard.reason };
  }

  // 대상 프로필
  const target = await loadTargetProfile(payload.user_id);
  if (!target.ok) return { status: "failed", reason: target.reason };

  // 자기 자신 비활성화 금지 (deactivateAction 과 별개로 update 경유 차단)
  if (
    payload.user_id === cur.user.user_id &&
    payload.active === false
  ) {
    return { status: "failed", reason: "자기 자신을 비활성화할 수 없습니다" };
  }

  // 자기 자신의 role 강등(master → 그 외) 금지
  if (
    payload.user_id === cur.user.user_id &&
    payload.role !== undefined &&
    payload.role !== cur.user.role
  ) {
    return { status: "failed", reason: "자기 자신의 역할은 변경할 수 없습니다" };
  }

  type ProfilePatch = {
    name?: string;
    role?: string;
    branch?: string;
    active?: boolean;
  };
  const patch: ProfilePatch = {};
  if (payload.name !== undefined) patch.name = payload.name;
  if (payload.role !== undefined) patch.role = payload.role;
  if (payload.branch !== undefined) patch.branch = payload.branch;
  if (payload.active !== undefined) patch.active = payload.active;

  if (Object.keys(patch).length === 0) {
    return { status: "success" };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await (
    supabase.from("crm_users_profile") as unknown as {
      update: (v: ProfilePatch) => {
        eq: (col: string, val: string) => Promise<{
          error: { message: string } | null;
        }>;
      };
    }
  )
    .update(patch)
    .eq("user_id", payload.user_id);

  if (error) {
    return {
      status: "failed",
      reason: `계정 수정에 실패했습니다: ${error.message}`,
    };
  }

  revalidatePath("/accounts");
  return { status: "success" };
}

// ─── deactivateAccountAction ──────────────────────────────

export async function deactivateAccountAction(
  userId: string,
): Promise<DeactivateAccountActionResult> {
  if (isDevSeedMode()) {
    return { status: "dev_seed_mode" };
  }

  if (!userId || typeof userId !== "string") {
    return { status: "failed", reason: "사용자 ID 가 유효하지 않습니다" };
  }

  const cur = await requireCurrentUser();
  if (!cur.ok) return { status: "failed", reason: cur.reason };

  const guard = requireMaster(cur.user);
  if (!guard.ok) {
    return { status: "failed", reason: guard.reason };
  }

  if (userId === cur.user.user_id) {
    return { status: "failed", reason: "자기 자신을 비활성화할 수 없습니다" };
  }

  const target = await loadTargetProfile(userId);
  if (!target.ok) return { status: "failed", reason: target.reason };

  const supabase = await createSupabaseServerClient();
  const { error } = await (
    supabase.from("crm_users_profile") as unknown as {
      update: (v: { active: boolean }) => {
        eq: (col: string, val: string) => Promise<{
          error: { message: string } | null;
        }>;
      };
    }
  )
    .update({ active: false })
    .eq("user_id", userId);

  if (error) {
    return {
      status: "failed",
      reason: `계정 비활성화에 실패했습니다: ${error.message}`,
    };
  }

  revalidatePath("/accounts");
  return { status: "success" };
}

// ─── reactivateAccountAction ──────────────────────────────

export async function reactivateAccountAction(
  userId: string,
): Promise<ReactivateAccountActionResult> {
  if (isDevSeedMode()) {
    return { status: "dev_seed_mode" };
  }

  if (!userId || typeof userId !== "string") {
    return { status: "failed", reason: "사용자 ID 가 유효하지 않습니다" };
  }

  const cur = await requireCurrentUser();
  if (!cur.ok) return { status: "failed", reason: cur.reason };

  const guard = requireMaster(cur.user);
  if (!guard.ok) {
    return { status: "failed", reason: guard.reason };
  }

  const target = await loadTargetProfile(userId);
  if (!target.ok) return { status: "failed", reason: target.reason };

  // must_change_password 는 건드리지 않는다 (재활성화는 비밀번호 정책과 무관).
  const supabase = await createSupabaseServerClient();
  const { error } = await (
    supabase.from("crm_users_profile") as unknown as {
      update: (v: { active: boolean }) => {
        eq: (col: string, val: string) => Promise<{
          error: { message: string } | null;
        }>;
      };
    }
  )
    .update({ active: true })
    .eq("user_id", userId);

  if (error) {
    return {
      status: "failed",
      reason: `계정 재활성화에 실패했습니다: ${error.message}`,
    };
  }

  revalidatePath("/accounts");
  return { status: "success" };
}
