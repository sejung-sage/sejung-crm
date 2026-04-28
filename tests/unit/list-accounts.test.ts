import { describe, it, expect, beforeEach } from "vitest";
import { listAccounts } from "@/lib/accounts/list-accounts";
import { DEV_ACCOUNTS } from "@/lib/profile/students-dev-seed";

/**
 * F4 · 계정 목록 조회 (dev-seed 모드).
 *
 * dev-seed 시드는 6건:
 *   master 1 / admin 2 (대치·송도) / manager 1 (대치) / viewer 1 (송도)
 *   + 비활성 viewer 1 (대치)
 */

describe("listAccounts() · dev-seed", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("빈 쿼리 → 6건 모두", async () => {
    const r = await listAccounts({ q: "", branch: "", page: 1 });
    expect(r.total).toBe(6);
    expect(r.items.length).toBe(6);
  });

  it("branch '대치' → 대치 소속만 (master + admin + manager + 비활성 viewer = 4)", async () => {
    const r = await listAccounts({ q: "", branch: "대치", page: 1 });
    const expected = DEV_ACCOUNTS.filter((a) => a.branch === "대치").length;
    expect(r.total).toBe(expected);
    expect(r.items.every((a) => a.branch === "대치")).toBe(true);
  });

  it("role 'master' → master 1명", async () => {
    const r = await listAccounts({
      q: "",
      branch: "",
      role: "master",
      page: 1,
    });
    expect(r.total).toBe(1);
    expect(r.items[0]?.role).toBe("master");
  });

  it("active 'false' → 비활성 1건", async () => {
    const r = await listAccounts({
      q: "",
      branch: "",
      active: "false",
      page: 1,
    });
    expect(r.total).toBe(1);
    expect(r.items[0]?.active).toBe(false);
  });

  it("active 'true' → 활성 5건", async () => {
    const r = await listAccounts({
      q: "",
      branch: "",
      active: "true",
      page: 1,
    });
    expect(r.total).toBe(5);
    expect(r.items.every((a) => a.active === true)).toBe(true);
  });

  it("q '원장' → 이름에 '원장' 들어간 admin 2건 (김원장·이원장)", async () => {
    const r = await listAccounts({ q: "원장", branch: "", page: 1 });
    expect(r.total).toBe(2);
    expect(r.items.every((a) => a.name.includes("원장"))).toBe(true);
  });

  it("q '마스터' → 1건 (개발용 마스터)", async () => {
    const r = await listAccounts({ q: "마스터", branch: "", page: 1 });
    expect(r.total).toBe(1);
  });

  it("페이지네이션: page 2 → 빈 items + total 유지", async () => {
    const r = await listAccounts({ q: "", branch: "", page: 2 });
    expect(r.items.length).toBe(0);
    expect(r.total).toBe(6);
  });
});
