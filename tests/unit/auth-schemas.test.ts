import { describe, it, expect } from "vitest";
import {
  LoginInputSchema,
  CreateAccountInputSchema,
  UpdateAccountInputSchema,
  ChangePasswordInputSchema,
  AccountListQuerySchema,
} from "@/lib/schemas/auth";

/**
 * F4 · 계정·권한 Zod 스키마 검증.
 *
 * 사용자 노출용 한글 메시지는 계약(contract). 메시지가 바뀌면 UI 도 함께 보정해야 함.
 */

describe("LoginInputSchema", () => {
  it("정상: 유효 이메일 + 8자 비번 → success", () => {
    const r = LoginInputSchema.safeParse({
      email: "user@example.com",
      password: "abcd1234",
    });
    expect(r.success).toBe(true);
  });

  it("실패: email 형식 오류", () => {
    const r = LoginInputSchema.safeParse({
      email: "not-an-email",
      password: "abcd1234",
    });
    expect(r.success).toBe(false);
  });

  it("실패: 비번 7자", () => {
    const r = LoginInputSchema.safeParse({
      email: "user@example.com",
      password: "abc1234",
    });
    expect(r.success).toBe(false);
  });
});

describe("CreateAccountInputSchema", () => {
  it("정상 → success", () => {
    const r = CreateAccountInputSchema.safeParse({
      email: "new@example.com",
      name: "홍길동",
      role: "manager",
      branch: "대치",
    });
    expect(r.success).toBe(true);
  });

  it("실패: email 오류", () => {
    const r = CreateAccountInputSchema.safeParse({
      email: "bad",
      name: "홍길동",
      role: "manager",
      branch: "대치",
    });
    expect(r.success).toBe(false);
  });

  it("실패: name 빈값", () => {
    const r = CreateAccountInputSchema.safeParse({
      email: "new@example.com",
      name: "",
      role: "manager",
      branch: "대치",
    });
    expect(r.success).toBe(false);
  });

  it("실패: name 21자(20자 초과)", () => {
    const r = CreateAccountInputSchema.safeParse({
      email: "new@example.com",
      name: "가".repeat(21),
      role: "manager",
      branch: "대치",
    });
    expect(r.success).toBe(false);
  });

  it("실패: role 잘못", () => {
    const r = CreateAccountInputSchema.safeParse({
      email: "new@example.com",
      name: "홍길동",
      role: "superuser",
      branch: "대치",
    });
    expect(r.success).toBe(false);
  });

  it("실패: branch 빈값", () => {
    const r = CreateAccountInputSchema.safeParse({
      email: "new@example.com",
      name: "홍길동",
      role: "manager",
      branch: "",
    });
    expect(r.success).toBe(false);
  });
});

describe("UpdateAccountInputSchema", () => {
  const validUuid = "11111111-1111-4111-8111-111111111111";

  it("실패: user_id 가 UUID 아님", () => {
    const r = UpdateAccountInputSchema.safeParse({
      user_id: "not-a-uuid",
      name: "변경",
    });
    expect(r.success).toBe(false);
  });

  it("정상: name 만 부분 입력", () => {
    const r = UpdateAccountInputSchema.safeParse({
      user_id: validUuid,
      name: "수정된 이름",
    });
    expect(r.success).toBe(true);
  });

  it("정상: role 만 부분 입력", () => {
    const r = UpdateAccountInputSchema.safeParse({
      user_id: validUuid,
      role: "admin",
    });
    expect(r.success).toBe(true);
  });

  it("정상: active 만 부분 입력", () => {
    const r = UpdateAccountInputSchema.safeParse({
      user_id: validUuid,
      active: false,
    });
    expect(r.success).toBe(true);
  });

  it("정상: user_id 만 (모든 필드 optional)", () => {
    const r = UpdateAccountInputSchema.safeParse({
      user_id: validUuid,
    });
    expect(r.success).toBe(true);
  });
});

describe("ChangePasswordInputSchema", () => {
  it("정상: 영문+숫자 8자 + 일치 → success", () => {
    const r = ChangePasswordInputSchema.safeParse({
      newPassword: "abcd1234",
      confirmPassword: "abcd1234",
    });
    expect(r.success).toBe(true);
  });

  it("실패: newPassword 7자", () => {
    const r = ChangePasswordInputSchema.safeParse({
      newPassword: "abc1234",
      confirmPassword: "abc1234",
    });
    expect(r.success).toBe(false);
  });

  it("실패: newPassword 영문만", () => {
    const r = ChangePasswordInputSchema.safeParse({
      newPassword: "abcdefgh",
      confirmPassword: "abcdefgh",
    });
    expect(r.success).toBe(false);
  });

  it("실패: newPassword 숫자만", () => {
    const r = ChangePasswordInputSchema.safeParse({
      newPassword: "12345678",
      confirmPassword: "12345678",
    });
    expect(r.success).toBe(false);
  });

  it("실패: newPassword !== confirmPassword (path: confirmPassword)", () => {
    const r = ChangePasswordInputSchema.safeParse({
      newPassword: "abcd1234",
      confirmPassword: "abcd9999",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const mismatch = r.error.issues.find(
        (i) => i.path.join(".") === "confirmPassword",
      );
      expect(mismatch).toBeDefined();
      expect(mismatch?.message).toBe("비밀번호 확인이 일치하지 않습니다");
    }
  });
});

describe("AccountListQuerySchema", () => {
  it("page coerce: 문자열 '2' → 숫자 2", () => {
    const r = AccountListQuerySchema.safeParse({ page: "2" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(2);
    }
  });

  it("page 미입력 → default 1", () => {
    const r = AccountListQuerySchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(1);
    }
  });

  it("실패: active 잘못된 값", () => {
    const r = AccountListQuerySchema.safeParse({ active: "yes" });
    expect(r.success).toBe(false);
  });

  it("실패: role 잘못된 값", () => {
    const r = AccountListQuerySchema.safeParse({ role: "superuser" });
    expect(r.success).toBe(false);
  });

  it("정상: 모든 필드 입력", () => {
    const r = AccountListQuerySchema.safeParse({
      q: "홍",
      role: "admin",
      branch: "대치",
      active: "true",
      page: "1",
    });
    expect(r.success).toBe(true);
  });
});
