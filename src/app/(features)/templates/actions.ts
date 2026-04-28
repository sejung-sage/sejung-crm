"use server";

/**
 * F3-A · 템플릿 Server Actions
 *
 * 공통 정책:
 *   - dev-seed 모드에서는 모든 쓰기 액션이 `{ status: 'dev_seed_mode' }` 반환.
 *     UI 에서는 "시드라 저장되지 않습니다" 회색 안내 박스.
 *   - 인증/권한: users_profile.role ∈ {master, admin} 만 생성/수정/삭제.
 *   - 입력 검증: CreateTemplateInputSchema / UpdateTemplateInputSchema 재검증.
 *
 * NOTE (frontend-dev 작성 stub): backend-dev 가 실제 Supabase 쓰기 로직으로
 *   덮어쓸 예정. 공개 시그니처(`createTemplateAction`, `updateTemplateAction`,
 *   `deleteTemplateAction`, 결과 타입) 는 유지.
 */

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import {
  CreateTemplateInputSchema,
  UpdateTemplateInputSchema,
  type CreateTemplateInput,
  type UpdateTemplateInput,
} from "@/lib/schemas/template";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { countEucKrBytes } from "@/lib/messaging/sms-bytes";

// ─── 결과 타입 ──────────────────────────────────────────────

export type CreateTemplateActionResult =
  | { status: "success"; id: string }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode" };

export type UpdateTemplateActionResult =
  | { status: "success" }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode" };

export type DeleteTemplateActionResult =
  | { status: "success" }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode" };

// ─── 내부 유틸 ─────────────────────────────────────────────

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
    .from("users_profile")
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
    return { ok: false, reason: "권한이 없습니다 (master / admin 만 가능)" };
  }
  return { ok: true, userId: user.id };
}

function zodErrorToReason(err: ZodError): string {
  const first = err.issues[0];
  if (!first) return "입력 값이 올바르지 않습니다";
  return first.message || "입력 값이 올바르지 않습니다";
}

// ─── createTemplateAction ──────────────────────────────────

export async function createTemplateAction(
  input: CreateTemplateInput,
): Promise<CreateTemplateActionResult> {
  if (isDevSeedMode()) {
    return { status: "dev_seed_mode" };
  }

  let parsed: CreateTemplateInput;
  try {
    parsed = CreateTemplateInputSchema.parse(input);
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
  const insertPayload: Record<string, unknown> = {
    name: parsed.name,
    subject: parsed.type === "SMS" ? null : parsed.subject,
    body: parsed.body,
    type: parsed.type,
    teacher_name: parsed.teacher_name ?? null,
    auto_captured: false,
    is_ad: parsed.is_ad,
    byte_count: countEucKrBytes(parsed.body),
    created_by: auth.userId,
  };

  const { data, error } = await (
    supabase.from("templates") as unknown as {
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
      reason: `템플릿 생성에 실패했습니다: ${error.message}`,
    };
  }
  if (!data) {
    return { status: "failed", reason: "생성된 템플릿 ID 를 읽지 못했습니다" };
  }

  revalidatePath("/templates");
  return { status: "success", id: data.id };
}

// ─── updateTemplateAction ──────────────────────────────────

export async function updateTemplateAction(
  input: UpdateTemplateInput,
): Promise<UpdateTemplateActionResult> {
  if (isDevSeedMode()) {
    return { status: "dev_seed_mode" };
  }

  let parsed: UpdateTemplateInput;
  try {
    parsed = UpdateTemplateInputSchema.parse(input);
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
  const patch: Record<string, unknown> = {
    name: parsed.name,
    subject: parsed.type === "SMS" ? null : parsed.subject,
    body: parsed.body,
    type: parsed.type,
    teacher_name: parsed.teacher_name ?? null,
    is_ad: parsed.is_ad,
    byte_count: countEucKrBytes(parsed.body),
  };

  const { error } = await (
    supabase.from("templates") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (
          col: string,
          val: string,
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )
    .update(patch)
    .eq("id", parsed.id);

  if (error) {
    return {
      status: "failed",
      reason: `템플릿 수정에 실패했습니다: ${error.message}`,
    };
  }

  revalidatePath("/templates");
  revalidatePath(`/templates/${parsed.id}/edit`);
  return { status: "success" };
}

// ─── deleteTemplateAction ──────────────────────────────────

export async function deleteTemplateAction(
  id: string,
): Promise<DeleteTemplateActionResult> {
  if (isDevSeedMode()) {
    return { status: "dev_seed_mode" };
  }

  if (!id || typeof id !== "string") {
    return { status: "failed", reason: "템플릿 ID 가 유효하지 않습니다" };
  }

  const auth = await assertWriteRole();
  if (!auth.ok) {
    return { status: "failed", reason: auth.reason };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("templates").delete().eq("id", id);

  if (error) {
    return {
      status: "failed",
      reason: `템플릿 삭제에 실패했습니다: ${error.message}`,
    };
  }

  revalidatePath("/templates");
  return { status: "success" };
}
