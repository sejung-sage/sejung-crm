/**
 * F4 계정·권한 Zod 스키마
 *
 * Server Action 입력, 폼 입력의 런타임 검증 단일 출처.
 * 에러 메시지는 한글(사용자 노출용). 컬럼명 자체는 snake_case 유지.
 *
 * 비밀번호 정책:
 *  - 8자 이상, 72자 이하(bcrypt 한계)
 *  - 영문+숫자 포함 (특수문자는 필수 아님 — 40~60대 사용자 배려)
 *  - Supabase Auth 기본 6자 정책보다 앱 레이어에서 강하게 강제
 */

import { z } from "zod";
import { UserRoleSchema } from "@/lib/schemas/common";

// ─── 로그인 ──────────────────────────────────────────────────

export const LoginInputSchema = z.object({
  email: z.string().trim().email("이메일 형식이 올바르지 않습니다"),
  password: z.string().min(8, "비밀번호는 8자 이상입니다"),
});

export type LoginInput = z.infer<typeof LoginInputSchema>;

// ─── 계정 생성 (초대) ────────────────────────────────────────
//
// master/admin 이 /accounts/new 에서 입력.
// 서버에서 Supabase Admin API 로 auth.users 생성 + 임시 비밀번호 메일 발송 후
// users_profile 에 must_change_password=TRUE 로 insert.

export const CreateAccountInputSchema = z.object({
  email: z.string().trim().email("이메일 형식이 올바르지 않습니다"),
  name: z.string().trim().min(1, "이름은 필수입니다").max(20, "이름은 20자 이하입니다"),
  role: UserRoleSchema,
  branch: z.string().trim().min(1, "분원은 필수입니다").max(20, "분원은 20자 이하입니다"),
});

export type CreateAccountInput = z.infer<typeof CreateAccountInputSchema>;

// ─── 계정 수정 ───────────────────────────────────────────────

export const UpdateAccountInputSchema = z.object({
  user_id: z.string().uuid("사용자 ID 가 유효하지 않습니다"),
  name: z.string().trim().min(1).max(20).optional(),
  role: UserRoleSchema.optional(),
  branch: z.string().trim().min(1).max(20).optional(),
  active: z.boolean().optional(),
});

export type UpdateAccountInput = z.infer<typeof UpdateAccountInputSchema>;

// ─── 비밀번호 변경 ───────────────────────────────────────────
//
// currentPassword 는 "강제 변경"(첫 로그인 플로우)일 때 선택적(UI 에서 숨김).
// 일반 /me 에서 변경할 때는 UI 에서 현재 비밀번호 필드를 필수로 요구.

export const ChangePasswordInputSchema = z
  .object({
    currentPassword: z.string().min(1, "현재 비밀번호를 입력하세요").optional(),
    newPassword: z
      .string()
      .min(8, "새 비밀번호는 8자 이상입니다")
      .max(72, "새 비밀번호는 72자 이하입니다")
      .regex(/[A-Za-z]/, "영문을 포함해야 합니다")
      .regex(/[0-9]/, "숫자를 포함해야 합니다"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "비밀번호 확인이 일치하지 않습니다",
    path: ["confirmPassword"],
  });

export type ChangePasswordInput = z.infer<typeof ChangePasswordInputSchema>;

// ─── 계정 목록 쿼리 ──────────────────────────────────────────

export const AccountListQuerySchema = z.object({
  q: z.string().trim().optional().default(""),
  role: UserRoleSchema.optional(),
  branch: z.string().trim().optional().default(""),
  active: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
});

export type AccountListQuery = z.infer<typeof AccountListQuerySchema>;
