"use server";

/**
 * F4 · 인증 Server Actions (loginAction / logoutAction / changePasswordAction)
 *
 * 정책:
 *   - 모든 입력은 Zod 스키마(@/lib/schemas/auth) 로 재검증.
 *   - 실패 사유는 한글(사용자 노출용). 보안상 "이메일 또는 비밀번호가 올바르지 않습니다"
 *     처럼 모호하게 노출(계정 enumeration 방지).
 *   - dev-seed 모드: changePassword 만 `dev_seed_mode` 즉시 반환.
 *     login/logout 은 dev-seed 모드에서도 호출 가능하지만 의미 없음 → 무해 처리.
 *   - 로그를 남기지 않는다(개인정보).
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import {
  ChangePasswordInputSchema,
  LoginInputSchema,
  type ChangePasswordInput,
} from "@/lib/schemas/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";

// ─── 결과 타입 ──────────────────────────────────────────────

export type LoginActionResult =
  | { status: "success" }
  | { status: "failed"; reason: string };

export type ChangePasswordActionResult =
  | { status: "success" }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode" };

// ─── 내부 유틸 ─────────────────────────────────────────────

function zodErrorToReason(err: ZodError): string {
  const first = err.issues[0];
  if (!first) return "입력 값이 올바르지 않습니다";
  return first.message || "입력 값이 올바르지 않습니다";
}

// ─── loginAction ───────────────────────────────────────────

/**
 * 로그인.
 * - email/password Zod 검증.
 * - signInWithPassword 호출.
 * - 성공 시 `revalidatePath('/')` (헤더의 사용자 표시 즉시 갱신).
 * - 비활성 계정은 미들웨어에서 즉시 로그아웃되지만, 여기서도 1차 차단.
 *
 * UI 폼은 FormData 로 호출. (Server Action 표준 패턴)
 */
export async function loginAction(
  formData: FormData,
): Promise<LoginActionResult> {
  if (isDevSeedMode()) {
    // dev-seed 에선 미들웨어가 통과시키므로 로그인이 의미 없지만,
    // UI 가 호출했을 경우 친절히 success 처리.
    return { status: "success" };
  }

  const raw = {
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  };

  const parsed = LoginInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: "failed",
      reason: zodErrorToReason(parsed.error),
    };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error || !data.user) {
    // 보안: 사유 모호화
    return {
      status: "failed",
      reason: "이메일 또는 비밀번호가 올바르지 않습니다",
    };
  }

  // 비활성 계정 차단 (1차)
  const { data: profile } = await supabase
    .from("users_profile")
    .select("active")
    .eq("user_id", data.user.id)
    .maybeSingle();

  const p = profile as { active?: boolean } | null;
  if (!p || p.active === false) {
    await supabase.auth.signOut();
    return {
      status: "failed",
      reason: "비활성 계정은 사용할 수 없습니다",
    };
  }

  revalidatePath("/");
  return { status: "success" };
}

// ─── logoutAction ──────────────────────────────────────────

/**
 * 로그아웃 + /login 리다이렉트.
 * dev-seed 모드에선 세션이 없지만 그래도 /login 으로 보냄(시연 의도 존중).
 */
export async function logoutAction(): Promise<void> {
  if (!isDevSeedMode()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}

// ─── changePasswordAction ─────────────────────────────────

/**
 * 비밀번호 변경.
 *
 * 두 가지 컨텍스트:
 *   1) 첫 로그인 강제 변경(must_change_password=true): currentPassword 생략 허용.
 *      → Supabase 세션은 이미 invite 토큰으로 인증된 상태이므로
 *        그냥 updateUser({ password }) 만 호출하면 충분.
 *   2) 일반 /me 변경: currentPassword 필수. 현재 비밀번호로 reauth 후 변경.
 *
 * 성공 시 must_change_password=false 로 업데이트.
 */
export async function changePasswordAction(
  input: ChangePasswordInput,
): Promise<ChangePasswordActionResult> {
  if (isDevSeedMode()) {
    return { status: "dev_seed_mode" };
  }

  // 1) Zod 검증
  const parsed = ChangePasswordInputSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "failed", reason: zodErrorToReason(parsed.error) };
  }
  const { currentPassword, newPassword } = parsed.data;

  // 2) 현재 사용자 조회 (auth + profile)
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user || !user.email) {
    return { status: "failed", reason: "로그인 후 이용 가능합니다" };
  }

  const { data: profile } = await supabase
    .from("users_profile")
    .select("must_change_password, active")
    .eq("user_id", user.id)
    .maybeSingle();

  const p = profile as
    | { must_change_password: boolean; active: boolean }
    | null;

  if (!p || !p.active) {
    return { status: "failed", reason: "사용할 수 없는 계정입니다" };
  }

  const isForced = p.must_change_password === true;

  // 3) 일반 변경이면 현재 비밀번호 필수 + reauth
  if (!isForced) {
    if (!currentPassword || currentPassword.length === 0) {
      return { status: "failed", reason: "현재 비밀번호를 입력하세요" };
    }
    const { error: reauthErr } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (reauthErr) {
      return { status: "failed", reason: "현재 비밀번호가 올바르지 않습니다" };
    }
  }

  // 4) 비밀번호 업데이트
  const { error: updateErr } = await supabase.auth.updateUser({
    password: newPassword,
  });
  if (updateErr) {
    return {
      status: "failed",
      reason: `비밀번호 변경에 실패했습니다: ${updateErr.message}`,
    };
  }

  // 5) must_change_password=false 로 플래그 해제
  const { error: flagErr } = await (
    supabase.from("users_profile") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (col: string, val: string) => Promise<{
          error: { message: string } | null;
        }>;
      };
    }
  )
    .update({ must_change_password: false })
    .eq("user_id", user.id);

  if (flagErr) {
    // 비밀번호는 바뀌었지만 플래그가 안 풀린 상태. 사용자 다시 로그인 시 또 막히므로
    // 실패로 보고하되, 로그아웃은 시키지 않음(다음 시도로 회복 가능).
    return {
      status: "failed",
      reason: `프로필 갱신에 실패했습니다: ${flagErr.message}`,
    };
  }

  revalidatePath("/me");
  return { status: "success" };
}
