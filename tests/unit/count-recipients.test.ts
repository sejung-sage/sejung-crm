import { describe, it, expect, beforeEach } from "vitest";
import { countRecipients } from "@/lib/groups/count-recipients";
import type { GroupFilters } from "@/lib/schemas/group";

/**
 * F2 · countRecipients 단위 테스트.
 *
 * dev-seed 모드 전용: isDevSeedMode() == true 가 되도록 env 조정.
 * Supabase 경로는 실 DB 없이 단위 검증 어려움 → 통합 테스트 범위.
 */

const emptyFilters: GroupFilters = { grades: [], schools: [], subjects: [] };

describe("countRecipients · dev seed", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  describe("grades 필터", () => {
    it("grades=[2] · branch='대치' → DC0001·DC0002 2명", async () => {
      const r = await countRecipients(
        { ...emptyFilters, grades: [2] },
        "대치",
      );
      expect(r.total).toBe(2);
      expect(r.sample.length).toBe(2);
    });

    it("grades=[3] · branch='대치' → 고3 2명(DC0003·DC0005)", async () => {
      const r = await countRecipients(
        { ...emptyFilters, grades: [3] },
        "대치",
      );
      expect(r.total).toBe(2);
    });
  });

  describe("schools 필터 · 경계값", () => {
    it("없는 학교 필터 → total=0, sample 빈 배열", async () => {
      const r = await countRecipients(
        { ...emptyFilters, schools: ["존재하지않는학교"] },
        "대치",
      );
      expect(r.total).toBe(0);
      expect(r.sample).toEqual([]);
    });
  });

  describe("subjects 필터(수강 데이터 반영)", () => {
    it("subjects=['수학'] · 대치 · DC0001·DC0003 2명", async () => {
      const r = await countRecipients(
        { ...emptyFilters, subjects: ["수학"] },
        "대치",
      );
      expect(r.total).toBe(2);
      expect(r.sample.length).toBe(2);
    });

    it("subjects=['탐구'] · 송도 · 강도윤 1명", async () => {
      const r = await countRecipients(
        { ...emptyFilters, subjects: ["탐구"] },
        "송도",
      );
      expect(r.total).toBe(1);
      expect(r.sample[0].name).toBe("강도윤");
    });
  });

  describe("sample 구조", () => {
    it("sample 배열 길이 ≤ 5 (SAMPLE_SIZE)", async () => {
      const r = await countRecipients(emptyFilters, "대치");
      expect(r.sample.length).toBeLessThanOrEqual(5);
    });

    it("sample 각 항목에 name·school·grade 가 존재", async () => {
      const r = await countRecipients(emptyFilters, "대치");
      expect(r.sample.length).toBeGreaterThan(0);
      for (const s of r.sample) {
        expect(typeof s.name).toBe("string");
        expect("school" in s).toBe(true); // null 허용
        expect("grade" in s).toBe(true); // null 허용
      }
    });
  });

  describe("탈퇴·수신거부 자동 제외", () => {
    it("송도 전체 · 탈퇴(SD0004) 제외되어 4명", async () => {
      const r = await countRecipients(emptyFilters, "송도");
      expect(r.total).toBe(4);
      expect(r.sample.every((s) => s.name !== "한예린")).toBe(true);
    });
  });
});
