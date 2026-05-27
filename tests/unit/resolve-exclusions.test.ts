import { describe, it, expect } from "vitest";
import {
  encodePostgrestInList,
  mergeExcludedStudentIds,
} from "@/lib/groups/resolve-exclusions";

/**
 * F2 · 학교별/강좌별 제외 공통 헬퍼(순수 함수) 단위 테스트.
 *
 * 검증 대상은 네트워크/Supabase 가 필요 없는 두 순수 함수:
 *   - encodePostgrestInList : PostgREST `not.in` 리스트 값 인코딩(메타문자 방어)
 *   - mergeExcludedStudentIds : 명시 제외 ∪ 강좌 제외 distinct 병합
 *
 * 구조: describe(함수) → describe(시나리오) → it(경계값).
 */

describe("encodePostgrestInList", () => {
  describe("일반 값", () => {
    it("단일 학교명을 큰따옴표로 감싼다", () => {
      expect(encodePostgrestInList(["서울고"])).toBe('"서울고"');
    });

    it("복수 학교명을 콤마로 join 하고 각각 따옴표로 감싼다", () => {
      expect(encodePostgrestInList(["서울고", "휘문고"])).toBe(
        '"서울고","휘문고"',
      );
    });
  });

  describe("메타문자 방어", () => {
    it("학교명 안의 콤마는 따옴표로 보호되어 구분자와 구별된다", () => {
      // "A,B고" 는 한 개의 값. 따옴표로 감싸 콤마가 리스트 구분자로 오인되지 않음.
      expect(encodePostgrestInList(["서울고", "A,B고"])).toBe(
        '"서울고","A,B고"',
      );
    });

    it("학교명 안의 큰따옴표는 두 번 반복(CSV/PostgREST 규칙)으로 이스케이프", () => {
      // 입력 한 개에 큰따옴표 한 개 → 출력은 안쪽 "" 두 개 + 바깥 감싸기 따옴표.
      expect(encodePostgrestInList(['12"중'])).toBe('"12""중"');
    });

    it("괄호가 포함되어도 따옴표 안에 그대로 보존", () => {
      expect(encodePostgrestInList(["(분교)고"])).toBe('"(분교)고"');
    });
  });

  describe("경계값", () => {
    it("빈 배열이면 빈 문자열을 반환한다", () => {
      expect(encodePostgrestInList([])).toBe("");
    });
  });
});

describe("mergeExcludedStudentIds", () => {
  // uuid 형태가 아니어도 함수 계약상 문자열 distinct 병합만 검증 — 실제 호출부는 uuid.
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";
  const C = "33333333-3333-4333-8333-333333333333";

  describe("정상 병합", () => {
    it("두 배열을 distinct 로 합친다", () => {
      const r = mergeExcludedStudentIds([A, B], [C]);
      expect(r.sort()).toEqual([A, B, C].sort());
    });

    it("두 배열에 겹치는 id 는 한 번만 남는다(중복 제거)", () => {
      const r = mergeExcludedStudentIds([A, B], [B, C]);
      expect(r.sort()).toEqual([A, B, C].sort());
      expect(r.length).toBe(3);
    });

    it("같은 배열 내부 중복도 distinct 처리된다", () => {
      const r = mergeExcludedStudentIds([A, A, B], []);
      expect(r.sort()).toEqual([A, B].sort());
    });
  });

  describe("한쪽만 채워진 경우", () => {
    it("강좌 제외만 있고 명시 제외가 비면 강좌 제외만 반환", () => {
      const r = mergeExcludedStudentIds([], [A, B]);
      expect(r.sort()).toEqual([A, B].sort());
    });

    it("명시 제외만 있고 강좌 제외가 비면 명시 제외만 반환", () => {
      const r = mergeExcludedStudentIds([A], []);
      expect(r).toEqual([A]);
    });
  });

  describe("경계값", () => {
    it("둘 다 빈 배열이면 빈 배열을 반환한다", () => {
      expect(mergeExcludedStudentIds([], [])).toEqual([]);
    });
  });
});
