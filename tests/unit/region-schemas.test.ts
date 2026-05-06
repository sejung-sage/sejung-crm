import { describe, it, expect } from "vitest";
import { SchoolRegionUpsertSchema } from "@/lib/schemas/region";
import { parseStudentsSearchParams } from "@/lib/schemas/student";

/**
 * 학교 → 지역 매핑 관련 Zod 스키마·URL 파서 단위 테스트.
 *
 * 구조: describe(스키마/파서) → describe(시나리오) → describe(경계값).
 */

describe("SchoolRegionUpsertSchema", () => {
  describe("정상 입력", () => {
    it("학교명/지역명 1자 이상 + 양옆 trim", () => {
      const r = SchoolRegionUpsertSchema.parse({
        school: "  휘문고  ",
        region: "  강남구  ",
      });
      expect(r.school).toBe("휘문고");
      expect(r.region).toBe("강남구");
    });

    it("학교명 50자 경계 · 지역명 30자 경계 통과", () => {
      const school50 = "가".repeat(50);
      const region30 = "나".repeat(30);
      const r = SchoolRegionUpsertSchema.parse({
        school: school50,
        region: region30,
      });
      expect(r.school.length).toBe(50);
      expect(r.region.length).toBe(30);
    });

    it("공백 포함 지역명(예: '인천 송도') 허용", () => {
      const r = SchoolRegionUpsertSchema.parse({
        school: "송도고",
        region: "인천 송도",
      });
      expect(r.region).toBe("인천 송도");
    });
  });

  describe("경계값 · 거부", () => {
    it("학교명 빈 문자열 → 한글 메시지", () => {
      const parsed = SchoolRegionUpsertSchema.safeParse({
        school: "",
        region: "강남구",
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const msgs = parsed.error.issues.map((i) => i.message);
        expect(msgs.some((m) => m.includes("학교명"))).toBe(true);
      }
    });

    it("지역명 빈 문자열 → 한글 메시지", () => {
      const parsed = SchoolRegionUpsertSchema.safeParse({
        school: "휘문고",
        region: "",
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const msgs = parsed.error.issues.map((i) => i.message);
        expect(msgs.some((m) => m.includes("지역명"))).toBe(true);
      }
    });

    it("학교명 공백만 → trim 후 빈문자라 거부", () => {
      const parsed = SchoolRegionUpsertSchema.safeParse({
        school: "   ",
        region: "강남구",
      });
      expect(parsed.success).toBe(false);
    });

    it("지역명 공백만 → trim 후 빈문자라 거부", () => {
      const parsed = SchoolRegionUpsertSchema.safeParse({
        school: "휘문고",
        region: "   ",
      });
      expect(parsed.success).toBe(false);
    });

    it("학교명 51자 → 거부", () => {
      const parsed = SchoolRegionUpsertSchema.safeParse({
        school: "가".repeat(51),
        region: "강남구",
      });
      expect(parsed.success).toBe(false);
    });

    it("지역명 31자 → 거부", () => {
      const parsed = SchoolRegionUpsertSchema.safeParse({
        school: "휘문고",
        region: "나".repeat(31),
      });
      expect(parsed.success).toBe(false);
    });

    it("필드 누락 → 거부", () => {
      // 의도적인 unknown 캐스팅 — 외부 입력(폼)이 누락됐을 때를 시뮬레이션.
      const partial = { school: "휘문고" } as unknown;
      const parsed = SchoolRegionUpsertSchema.safeParse(partial);
      expect(parsed.success).toBe(false);
    });
  });
});

describe("parseStudentsSearchParams · regions URL 파싱", () => {
  describe("정상 입력", () => {
    it("?region=강남구&region=서초구 → ['강남구', '서초구']", () => {
      const r = parseStudentsSearchParams({ region: ["강남구", "서초구"] });
      expect(r.regions).toEqual(["강남구", "서초구"]);
    });

    it("단일 ?region=강남구 → ['강남구']", () => {
      const r = parseStudentsSearchParams({ region: "강남구" });
      expect(r.regions).toEqual(["강남구"]);
    });

    it("공백 포함 지역명도 그대로 유지", () => {
      const r = parseStudentsSearchParams({ region: "인천 송도" });
      expect(r.regions).toEqual(["인천 송도"]);
    });
  });

  describe("경계값", () => {
    it("?region 미지정 → []", () => {
      const r = parseStudentsSearchParams({});
      expect(r.regions).toEqual([]);
    });

    it("빈 문자열·공백만 → cleanFreeText 가 제거", () => {
      const r = parseStudentsSearchParams({ region: ["", "   ", "\t"] });
      expect(r.regions).toEqual([]);
    });

    it("값 양옆 공백은 trim 후 유지", () => {
      const r = parseStudentsSearchParams({ region: ["  강남구  "] });
      expect(r.regions).toEqual(["강남구"]);
    });

    it("빈 값과 정상 값이 섞여도 정상 값만 남김", () => {
      const r = parseStudentsSearchParams({
        region: ["", "강남구", "  ", "서초구"],
      });
      expect(r.regions).toEqual(["강남구", "서초구"]);
    });
  });
});
