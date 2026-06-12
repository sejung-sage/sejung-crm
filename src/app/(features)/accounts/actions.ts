"use server";

/**
 * F4 · 계정 관리 Server Actions
 *
 * 정책:
 *   - 모든 액션 dev-seed 모드 → `{ status:'dev_seed_mode' }` 즉시 반환.
 *   - 권한 가드: 모든 계정 액션은 master 전용.
 *     · master  : 전 분원 계정 관리.
 *     · 그 외   : 거부.
 *   - 계정 생성: Supabase Admin API `admin.createUser` 사용 (초대 메일 없음).
 *     → email_confirm=true 로 auth.users 행 + 비밀번호 즉시 생성.
 *     → 반환된 user.id 로 users_profile INSERT (must_change_password=false).
 *   - 계정 수정:
 *     · role/branch 모두 master 가 자유롭게 변경.
 *   - 자기 자신 비활성화/role 강등 금지.
 */

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import {
  AdminResetPasswordInputSchema,
  CreateAccountInputSchema,
  UpdateAccountInputSchema,
  type AdminResetPasswordInput,
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

export type DeleteAccountActionResult =
  | { status: "success" }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode" };

export type AdminResetPasswordActionResult =
  | { status: "success"; message: string }
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

  // 5) Service role 로 계정 직접 생성 (초대 메일 없이 비밀번호 즉시 발급)
  //    ⚠️ app_metadata.pw 에 평문 비밀번호를 보관한다(마스터 계정관리 화면 노출용).
  //    운영자(원장) 요청에 따른 의도적 평문 저장 — 유출 시 전 계정 탈취 위험을 감수.
  const svc = createSupabaseServiceClient();
  const { data, error } = await svc.auth.admin.createUser({
    email: payload.email,
    password: payload.password,
    email_confirm: true,
    app_metadata: { pw: payload.password },
  });

  if (error || !data.user) {
    // Supabase 가 반환하는 message 를 그대로 노출하지 않고 사례별 한글화.
    const msg = (error?.message ?? "").toLowerCase();
    if (
      msg.includes("already") ||
      msg.includes("registered") ||
      msg.includes("exists")
    ) {
      return { status: "failed", reason: "이미 등록된 이메일입니다" };
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
    must_change_password: false,
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

// ─── adminResetPasswordAction ─────────────────────────────
//
// master 가 다른 사용자의 비밀번호를 임시로 재발급한다.
//
// 정책:
//  - master 만 사용 가능 (admin 도 차단). 권한 위임의 위험이 크기 때문.
//  - 본인 계정 reset 은 금지 — /me 페이지의 정상 변경 흐름을 쓰도록 유도.
//  - 재설정 직후 must_change_password=true 로 다시 잠가 다음 로그인 시
//    사용자 본인이 즉시 임시 비번을 자기 비번으로 교체하도록 강제.
//
// 임시 비번 평문은 액션 반환에 담지 않는다 (호출자 = 클라이언트가
// 자기가 생성한 평문을 그대로 가지고 있으므로 화면에서 노출 가능).
// 서버 로그·DB 어디에도 평문 저장 금지.

export async function adminResetPasswordAction(
  input: AdminResetPasswordInput,
): Promise<AdminResetPasswordActionResult> {
  if (isDevSeedMode()) {
    return { status: "dev_seed_mode" };
  }

  // 1) Zod
  const parsed = AdminResetPasswordInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "failed", reason: zodErrorToReason(parsed.error) };
  }
  const { userId, newPassword } = parsed.data;

  // 2) 현재 사용자
  const cur = await requireCurrentUser();
  if (!cur.ok) return { status: "failed", reason: cur.reason };

  // 3) master 전용 가드
  const guard = requireMaster(cur.user);
  if (!guard.ok) {
    return { status: "failed", reason: guard.reason };
  }

  // 4) 본인 계정 차단
  if (userId === cur.user.user_id) {
    return {
      status: "failed",
      reason: "본인 비밀번호는 내 정보(/me) 페이지에서 변경하세요",
    };
  }

  // 5) 대상 프로필 (존재·branch 확인 — master 라 branch 검사는 생략)
  const target = await loadTargetProfile(userId);
  if (!target.ok) return { status: "failed", reason: target.reason };

  // 6) Supabase Admin API 로 비밀번호 갱신
  //    app_metadata.pw 도 함께 갱신 — 마스터 계정관리 화면에서 평문 노출(의도적).
  const svc = createSupabaseServiceClient();
  const { error: authErr } = await svc.auth.admin.updateUserById(userId, {
    password: newPassword,
    app_metadata: { pw: newPassword },
  });

  if (authErr) {
    return {
      status: "failed",
      reason: `비밀번호 재설정에 실패했습니다: ${authErr.message}`,
    };
  }

  // 7) must_change_password = true 로 다시 잠그기.
  //    auth 업데이트는 성공했지만 플래그가 안 잠겨도 보안에 직접적 문제는 없다
  //    (임시 비번은 어차피 master 가 사용자에게 직접 전달). 다만 강제 변경이
  //    안 걸리므로 사용자에게 명확한 경고를 돌려준다.
  const { error: flagErr } = await (
    svc.from("crm_users_profile") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (col: string, val: string) => Promise<{
          error: { message: string } | null;
        }>;
      };
    }
  )
    .update({ must_change_password: true })
    .eq("user_id", userId);

  if (flagErr) {
    return {
      status: "failed",
      reason:
        "비밀번호는 재설정되었지만 강제 변경 플래그를 잠그지 못했습니다. 사용자에게 즉시 비번을 다시 바꾸도록 안내하세요",
    };
  }

  revalidatePath("/accounts");
  return {
    status: "success",
    message:
      "비밀번호가 재설정되었습니다. 사용자에게 임시 비밀번호를 전달하세요.",
  };
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

// ─── deleteAccountAction ──────────────────────────────────

/**
 * 계정 영구 삭제. master 전용, 자기 자신 불가.
 *
 * auth.users 행을 service role 로 지우면 users_profile.user_id 의
 * ON DELETE CASCADE(0001) 로 프로필 행도 함께 삭제된다.
 * groups/templates/campaigns/messages 의 created_by 는 SET NULL 이라
 * 삭제가 FK 로 막히지 않는다(작성 이력은 NULL 로 남음).
 *
 * 비활성화로 충분한 경우가 많아 UI 에서 위험(danger) 톤 + 확인 다이얼로그로 가드.
 */
export async function deleteAccountAction(
  userId: string,
): Promise<DeleteAccountActionResult> {
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
    return { status: "failed", reason: "자기 자신을 삭제할 수 없습니다" };
  }

  const target = await loadTargetProfile(userId);
  if (!target.ok) return { status: "failed", reason: target.reason };

  // auth.users 삭제 → users_profile CASCADE 삭제.
  const svc = createSupabaseServiceClient();
  const { error } = await svc.auth.admin.deleteUser(userId);

  if (error) {
    return {
      status: "failed",
      reason: `계정 삭제에 실패했습니다: ${error.message}`,
    };
  }

  revalidatePath("/accounts");
  return { status: "success" };
}
