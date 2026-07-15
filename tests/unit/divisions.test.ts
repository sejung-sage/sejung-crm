import { describe, it, expect } from "vitest";
import {
  DIVISIONS,
  DEFAULT_DIVISION,
  branchDivisions,
  isDivision,
} from "@/config/divisions";

/**
 * 발신 division(발신 정체성) 축 (2026-07 도입).
 *
 * 같은 학생 DB·같은 sendon 계정을 쓰면서 발신 정체성만 나누는 축.
 * 대치분원은 본원(세정학원) + 수학관(세정학원 수학관) 두 정체성을 쓴다.
 * 여기서는 순수 상수/헬퍼만 검증(발송 안전가드는 division 과 무관 — 별도 파일).
 */

describe("divisions · 상수", () => {
  it("DIVISIONS 는 [본원, 수학관], 기본은 본원", () => {
    expect(DIVISIONS).toEqual(["본원", "수학관"]);
    expect(DEFAULT_DIVISION).toBe("본원");
  });
});

describe("branchDivisions · 분원별 선택 가능한 division", () => {
  describe("division 이 있는 분원", () => {
    it("대치 → [본원, 수학관]", () => {
      expect(branchDivisions("대치")).toEqual(["본원", "수학관"]);
    });
  });

  describe("division 이 없는 분원", () => {
    it("송도 → [본원]만", () => {
      expect(branchDivisions("송도")).toEqual(["본원"]);
    });

    it("반포·방배 → [본원]만", () => {
      expect(branchDivisions("반포")).toEqual(["본원"]);
      expect(branchDivisions("방배")).toEqual(["본원"]);
    });
  });

  describe("경계값 · 미지정/알 수 없음", () => {
    it("null / undefined / 빈 문자열 → [본원] 기본", () => {
      expect(branchDivisions(null)).toEqual(["본원"]);
      expect(branchDivisions(undefined)).toEqual(["본원"]);
      expect(branchDivisions("")).toEqual(["본원"]);
    });

    it("등록되지 않은 분원 → [본원] 기본", () => {
      expect(branchDivisions("없는분원")).toEqual(["본원"]);
      expect(branchDivisions("마스터")).toEqual(["본원"]);
    });

    it("반환 배열은 내부 상수의 복사본 (변형해도 다음 호출 불변)", () => {
      const first = branchDivisions("대치");
      first.push("수학관");
      expect(branchDivisions("대치")).toEqual(["본원", "수학관"]);
    });
  });
});

describe("isDivision · 외부 입력 좁힘 검증", () => {
  describe("유효한 division", () => {
    it("'본원' / '수학관' → true", () => {
      expect(isDivision("본원")).toBe(true);
      expect(isDivision("수학관")).toBe(true);
    });
  });

  describe("경계값 · 무효 입력", () => {
    it("빈 문자열 / null / undefined → false", () => {
      expect(isDivision("")).toBe(false);
      expect(isDivision(null)).toBe(false);
      expect(isDivision(undefined)).toBe(false);
    });

    it("부분 일치·오타('수학') → false", () => {
      expect(isDivision("수학")).toBe(false);
      expect(isDivision("본")).toBe(false);
      expect(isDivision(" 본원 ")).toBe(false);
    });

    it("비문자열(객체·숫자·불리언) → false", () => {
      expect(isDivision({ division: "본원" })).toBe(false);
      expect(isDivision(0)).toBe(false);
      expect(isDivision(1)).toBe(false);
      expect(isDivision(true)).toBe(false);
      expect(isDivision(["본원"])).toBe(false);
    });
  });
});
