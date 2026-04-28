import { describe, it, expect, beforeEach } from "vitest";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DEV_VIRTUAL_MASTER } from "@/lib/profile/students-dev-seed";

/**
 * F4 · 현재 로그인 사용자 조회.
 *
 * dev-seed 모드에서는 Supabase 호출 없이 즉시 DEV_VIRTUAL_MASTER 반환.
 * (실DB 모드는 Supabase 클라이언트 모킹이 필요해 unit 범위에서 제외 — E2E 영역.)
 */

describe("getCurrentUser() · dev-seed", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("dev-seed → DEV_VIRTUAL_MASTER 와 동일 객체 반환", async () => {
    const u = await getCurrentUser();
    expect(u).not.toBeNull();
    expect(u).toEqual(DEV_VIRTUAL_MASTER);
  });

  it("핵심 필드가 정확히 일치", async () => {
    const u = await getCurrentUser();
    expect(u?.role).toBe("master");
    expect(u?.user_id).toBe("dev-master-0001");
    expect(u?.must_change_password).toBe(false);
    expect(u?.active).toBe(true);
    expect(u?.email).toBe("dev-master@sejung.local");
    expect(u?.branch).toBe("대치");
  });
});
