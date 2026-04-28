import { describe, it, expect, beforeEach } from "vitest";
import { listGroups } from "@/lib/groups/list-groups";
import { GroupListQuerySchema } from "@/lib/schemas/group";

/**
 * F2 · listGroups 단위 테스트 (dev-seed 경로).
 *
 * 시드 그룹 4개:
 *   - dev-group-1 "대치 고2 전체" (branch=대치)
 *   - dev-group-2 "대치 수학 수강생" (branch=대치)
 *   - dev-group-3 "송도 고3 탐구" (branch=송도)
 *   - dev-group-4 "대치 휘문고 국어" (branch=대치)
 */

describe("listGroups · dev seed", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  describe("필터 미적용", () => {
    it("빈 쿼리 → 전체 4건 반환", async () => {
      const q = GroupListQuerySchema.parse({});
      const r = await listGroups(q);
      expect(r.total).toBe(4);
      expect(r.items.length).toBe(4);
    });

    it("last_sent_at DESC NULLS LAST 정렬 · 송도 탐구/대치 휘문고 국어는 뒤쪽", async () => {
      const q = GroupListQuerySchema.parse({});
      const r = await listGroups(q);
      const last2 = r.items.slice(-2).map((g) => g.id);
      expect(last2).toContain("dev-group-3");
      expect(last2).toContain("dev-group-4");
    });
  });

  describe("branch 필터", () => {
    it("branch='대치' → 대치 분원 3건", async () => {
      const q = GroupListQuerySchema.parse({ branch: "대치" });
      const r = await listGroups(q);
      expect(r.total).toBe(3);
      expect(r.items.every((g) => g.branch === "대치")).toBe(true);
    });

    it("branch='송도' → 송도 분원 1건", async () => {
      const q = GroupListQuerySchema.parse({ branch: "송도" });
      const r = await listGroups(q);
      expect(r.total).toBe(1);
      expect(r.items[0].id).toBe("dev-group-3");
    });
  });

  describe("q 검색(그룹명 부분일치)", () => {
    it("q='고2' → '대치 고2 전체' 1건", async () => {
      const q = GroupListQuerySchema.parse({ q: "고2" });
      const r = await listGroups(q);
      expect(r.total).toBe(1);
      expect(r.items[0].id).toBe("dev-group-1");
    });

    it("q='수학' → '대치 수학 수강생' 1건", async () => {
      const q = GroupListQuerySchema.parse({ q: "수학" });
      const r = await listGroups(q);
      expect(r.total).toBe(1);
      expect(r.items[0].id).toBe("dev-group-2");
    });

    it("q + branch 복합 · 송도 탐구", async () => {
      const q = GroupListQuerySchema.parse({ branch: "송도", q: "탐구" });
      const r = await listGroups(q);
      expect(r.total).toBe(1);
      expect(r.items[0].id).toBe("dev-group-3");
    });

    it("매칭 없는 q → 0건", async () => {
      const q = GroupListQuerySchema.parse({ q: "없는그룹명" });
      const r = await listGroups(q);
      expect(r.total).toBe(0);
      expect(r.items).toEqual([]);
    });
  });

  describe("페이지네이션 · 경계값", () => {
    it("page=1 (기본) · 4건 모두 1페이지에 포함(페이지당 50)", async () => {
      const q = GroupListQuerySchema.parse({ page: "1" });
      const r = await listGroups(q);
      expect(r.items.length).toBe(4);
    });

    it("page=2 · items 0건이나 total 은 유지", async () => {
      const q = GroupListQuerySchema.parse({ page: "2" });
      const r = await listGroups(q);
      expect(r.items).toEqual([]);
      expect(r.total).toBe(4);
    });
  });
});
