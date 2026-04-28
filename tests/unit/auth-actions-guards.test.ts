import { describe, it, expect, beforeEach } from "vitest";
import { changePasswordAction } from "@/app/(features)/(auth)/actions";

/**
 * F4 · 인증 Server Action dev-seed 가드.
 *
 * changePasswordAction 만 dev-seed 모드 차단.
 * loginAction 은 dev-seed 모드에서도 success 로 무해 처리되며 (FormData 의존이므로 별도 unit 검증 생략),
 * logoutAction 은 redirect() 만 호출하므로 unit 검증 가치가 낮아 스킵.
 */

describe("changePasswordAction · dev-seed", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("정상 입력이어도 dev-seed 면 dev_seed_mode 반환", async () => {
    const r = await changePasswordAction({
      newPassword: "abc12345",
      confirmPassword: "abc12345",
    });
    expect(r.status).toBe("dev_seed_mode");
  });

  it("currentPassword 함께 와도 dev_seed_mode (Zod 검증 전에 가드)", async () => {
    const r = await changePasswordAction({
      currentPassword: "old-password",
      newPassword: "new12345",
      confirmPassword: "new12345",
    });
    expect(r.status).toBe("dev_seed_mode");
  });

  it("Zod 위반(짧은 비번) 이어도 dev-seed 가 우선", async () => {
    const r = await changePasswordAction({
      newPassword: "short",
      confirmPassword: "short",
    });
    expect(r.status).toBe("dev_seed_mode");
  });
});
