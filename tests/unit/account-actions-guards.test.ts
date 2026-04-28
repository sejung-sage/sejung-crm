import { describe, it, expect, beforeEach } from "vitest";
import {
  createAccountAction,
  updateAccountAction,
  deactivateAccountAction,
  reactivateAccountAction,
} from "@/app/(features)/accounts/actions";
import { DEV_ACCOUNTS } from "@/lib/profile/students-dev-seed";

/**
 * F4 · 계정 Server Action dev-seed 가드.
 *
 * 모든 쓰기 액션은 dev-seed 모드에서 DB 접근 없이 즉시
 * `{ status: 'dev_seed_mode' }` 로 반환되어야 한다.
 */

describe("Account Server Actions · dev-seed 조기 반환", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("createAccountAction → dev_seed_mode", async () => {
    const r = await createAccountAction({
      email: "a@b.com",
      name: "테스트",
      role: "manager",
      branch: "대치",
    });
    expect(r.status).toBe("dev_seed_mode");
  });

  it("updateAccountAction (부분 입력 name 만) → dev_seed_mode", async () => {
    // dev-seed 의 user_id 는 UUID 형식이 아니지만, dev-seed 가드가
    // Zod 검증 이전에 동작하므로 그대로 통과해야 한다.
    const target = DEV_ACCOUNTS[0];
    if (!target) throw new Error("DEV_ACCOUNTS 비어있음");
    const r = await updateAccountAction({
      user_id: target.user_id,
      name: "변경",
    });
    expect(r.status).toBe("dev_seed_mode");
  });

  it("deactivateAccountAction → dev_seed_mode", async () => {
    const target = DEV_ACCOUNTS[1];
    if (!target) throw new Error("DEV_ACCOUNTS[1] 없음");
    const r = await deactivateAccountAction(target.user_id);
    expect(r.status).toBe("dev_seed_mode");
  });

  it("reactivateAccountAction → dev_seed_mode", async () => {
    const target = DEV_ACCOUNTS[2];
    if (!target) throw new Error("DEV_ACCOUNTS[2] 없음");
    const r = await reactivateAccountAction(target.user_id);
    expect(r.status).toBe("dev_seed_mode");
  });

  it("빈 userId 로 deactivate 호출이어도 dev_seed 가 우선", async () => {
    const r = await deactivateAccountAction("");
    expect(r.status).toBe("dev_seed_mode");
  });
});
