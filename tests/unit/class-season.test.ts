import { describe, it, expect } from "vitest";

import { SEASON_VALUES, SeasonSchema } from "@/lib/schemas/common";
import {
  ClassFiltersSchema,
  parseClassSearchParams,
} from "@/lib/schemas/class";

/**
 * 0070 마이그 — 강좌 시즌(season) Zod 스키마 + URL 파서 단위 테스트.
 *
 * 검증 포인트:
 *   1. SEASON_VALUES 6종 화이트리스트 일치
 *   2. SeasonSchema enum + nullable() 동작
 *   3. ClassFiltersSchema.season 은 optional — 미지정 시 undefined
 *   4. parseClassSearchParams 가 ?season=내신 화이트리스트 통과
 *   5. ?season= (빈 문자열) 또는 ?season=알수없음 은 undefined 로 fallback
 *   6. ?season=설명회 같은 다른 enum 값도 거부 (SEASON vs SUBJECT 격리 확인)
 */

describe("Zod · SEASON_VALUES + SeasonSchema (0070)", () => {
  it("SEASON_VALUES 는 정확히 6종 (사용자 결정)", () => {
    expect(SEASON_VALUES).toEqual([
      "여름방학특강",
      "겨울방학특강",
      "내신",
      "상반기정규",
      "하반기정규",
      "기타",
    ]);
    expect(SEASON_VALUES.length).toBe(6);
  });

  it("SeasonSchema · enum 6종만 허용", () => {
    for (const v of SEASON_VALUES) {
      expect(SeasonSchema.parse(v)).toBe(v);
    }
    expect(() => SeasonSchema.parse("봄학기")).toThrow();
    expect(() => SeasonSchema.parse("")).toThrow();
    expect(() => SeasonSchema.parse(null)).toThrow();
  });

  it("SeasonSchema · nullable() 래핑 시 null 허용 (DB CHECK 호환)", () => {
    const Nullable = SeasonSchema.nullable();
    expect(Nullable.parse(null)).toBeNull();
    expect(Nullable.parse("내신")).toBe("내신");
    expect(() => Nullable.parse("미정의값")).toThrow();
  });
});

describe("ClassFiltersSchema.season (0070)", () => {
  it("season 미지정 시 undefined — 필터 미적용", () => {
    const parsed = ClassFiltersSchema.parse({});
    expect(parsed.season).toBeUndefined();
  });

  it("season 6종 화이트리스트 통과", () => {
    for (const v of SEASON_VALUES) {
      const parsed = ClassFiltersSchema.parse({ season: v });
      expect(parsed.season).toBe(v);
    }
  });

  it("season 비-화이트리스트 값은 Zod 에서 거부", () => {
    expect(() =>
      ClassFiltersSchema.parse({ season: "사기적인값" }),
    ).toThrow();
  });
});

describe("parseClassSearchParams · season 라우팅 (0070)", () => {
  it("?season=내신 → filters.season = '내신'", () => {
    const f = parseClassSearchParams({ season: "내신" });
    expect(f.season).toBe("내신");
  });

  it("?season=여름방학특강 → filters.season = '여름방학특강'", () => {
    const f = parseClassSearchParams({ season: "여름방학특강" });
    expect(f.season).toBe("여름방학특강");
  });

  it("?season 미지정 → undefined (필터 미적용)", () => {
    const f = parseClassSearchParams({});
    expect(f.season).toBeUndefined();
  });

  it("?season= (빈 문자열) → undefined", () => {
    const f = parseClassSearchParams({ season: "" });
    expect(f.season).toBeUndefined();
  });

  it("?season=알수없음 → 화이트리스트 외 → undefined", () => {
    const f = parseClassSearchParams({ season: "알수없음" });
    expect(f.season).toBeUndefined();
  });

  it("?season=설명회 → 다른 enum(SUBJECT) 값이라도 SEASON 화이트리스트 외 → undefined", () => {
    // 0058 에서 subject 에 추가된 '설명회' 가 season 으로 새지 않는지 격리 확인.
    const f = parseClassSearchParams({ season: "설명회" });
    expect(f.season).toBeUndefined();
  });

  it("?season 이 배열로 들어와도 string 만 수용 (첫 값을 그대로 받지 않고 undefined)", () => {
    // parseClassSearchParams 의 season 처리는 string 만 인정 — 배열은 무시.
    const f = parseClassSearchParams({ season: ["내신", "기타"] });
    expect(f.season).toBeUndefined();
  });

  it("season 과 subject 가 동시에 들어와도 각자 독립 화이트리스트로 통과", () => {
    const f = parseClassSearchParams({ subject: "수학", season: "내신" });
    expect(f.subject).toBe("수학");
    expect(f.season).toBe("내신");
  });
});
