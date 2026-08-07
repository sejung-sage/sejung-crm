import { describe, it, expect } from "vitest";
import { intersectAllowedIds } from "@/lib/groups/resolve-class-tickets";
import { GroupFiltersSchema, isEmptyFilterCohort } from "@/lib/schemas/group";

/**
 * 강좌 + 회차 포함 필터(0118)의 순수 로직.
 *
 * loadIncludedClassStudentIds 자체는 Supabase 왕복이라 여기서 다루지 않고,
 * "조건 미적용(null)" 과 "매칭 0명([])" 을 섞으면 안 된다는 계약을 지키는
 * 교집합 헬퍼와 스키마 시맨틱을 검증한다.
 */

const UUID_A = "11111111-1111-4111-8111-111111111111";

describe("intersectAllowedIds", () => {
  it("양쪽 모두 조건 없음(null) → null", () => {
    expect(intersectAllowedIds(null, null)).toBeNull();
  });

  it("한쪽만 조건 있으면 그쪽을 그대로 반환", () => {
    expect(intersectAllowedIds(null, ["a", "b"])).toEqual(["a", "b"]);
    expect(intersectAllowedIds(["a"], null)).toEqual(["a"]);
  });

  it("둘 다 조건 있으면 교집합 (AND 시맨틱)", () => {
    expect(intersectAllowedIds(["a", "b", "c"], ["b", "c", "d"])).toEqual([
      "b",
      "c",
    ]);
  });

  it("교집합이 비면 빈 배열 — null(조건 없음) 로 새지 않는다", () => {
    // 이게 null 로 새면 "과목 A + 강좌 B" 가 조건 없음이 되어 전원 발송된다.
    expect(intersectAllowedIds(["a"], ["b"])).toEqual([]);
  });

  it("빈 배열(매칭 0명)은 교집합에서도 0명을 유지", () => {
    expect(intersectAllowedIds([], ["a"])).toEqual([]);
    expect(intersectAllowedIds(["a"], [])).toEqual([]);
  });
});

describe("GroupFilters · 강좌/회차 포함 (0118)", () => {
  it("키가 없으면 빈 배열로 채워진다 (옛 그룹 JSONB 호환)", () => {
    const f = GroupFiltersSchema.parse({ kind: "filter" });
    expect(f.includeClassIds).toEqual([]);
    expect(f.includeClassDates).toEqual([]);
  });

  it("수업일은 YYYY-MM-DD 형식만 허용", () => {
    expect(() =>
      GroupFiltersSchema.parse({ includeClassDates: ["2026-8-12"] }),
    ).toThrow();
    expect(() =>
      GroupFiltersSchema.parse({ includeClassDates: ["8월 12일"] }),
    ).toThrow();
    expect(
      GroupFiltersSchema.parse({ includeClassDates: ["2026-08-12"] })
        .includeClassDates,
    ).toEqual(["2026-08-12"]);
  });

  it("강좌를 고르면 '빈 코호트'가 아니다 (명단 자동 로드 대상)", () => {
    // isEmptyFilterCohort 가 true 면 작성 화면이 명단 로드를 건너뛴다.
    // 강좌만 고른 개강문자 케이스가 여기 걸리면 명단이 안 그려진다.
    const empty = GroupFiltersSchema.parse({ kind: "filter" });
    expect(isEmptyFilterCohort(empty)).toBe(true);

    const withClass = GroupFiltersSchema.parse({
      kind: "filter",
      includeClassIds: [UUID_A],
    });
    expect(isEmptyFilterCohort(withClass)).toBe(false);
  });
});
