import { describe, it, expect } from "vitest";
import {
  GroupFiltersSchema,
  CreateGroupInputSchema,
  UpdateGroupInputSchema,
  GroupListQuerySchema,
} from "@/lib/schemas/group";

/**
 * F2 · 발송 그룹 Zod 스키마 단위 테스트.
 *
 * 구조: describe(스키마) → describe(시나리오) → describe(경계값).
 */

describe("GroupFiltersSchema", () => {
  describe("정상 입력", () => {
    it("빈 객체 · 모든 필드 기본값(빈 배열) 적용", () => {
      const r = GroupFiltersSchema.parse({});
      expect(r).toEqual({ grades: [], schools: [], subjects: [] });
    });

    it("grades 고2·고3 복수 선택 성공", () => {
      const r = GroupFiltersSchema.parse({ grades: ["고2", "고3"] });
      expect(r.grades).toEqual(["고2", "고3"]);
      expect(r.schools).toEqual([]);
      expect(r.subjects).toEqual([]);
    });

    it("schools · subjects 복합 선택 성공", () => {
      const r = GroupFiltersSchema.parse({
        schools: ["휘문고", "단대부고"],
        subjects: ["수학"],
      });
      expect(r.schools).toEqual(["휘문고", "단대부고"]);
      expect(r.subjects).toEqual(["수학"]);
      expect(r.grades).toEqual([]);
    });
  });

  describe("경계값 · 유효성 거부", () => {
    it("grades 에 정규화 enum 외 값(예: 숫자 4 / '고4')이 섞이면 실패", () => {
      expect(() => GroupFiltersSchema.parse({ grades: [4] })).toThrow();
      expect(() => GroupFiltersSchema.parse({ grades: ["고4"] })).toThrow();
    });

    it("subjects 에 '기타'는 공통 Subject enum 에 없음 → 실패", () => {
      expect(() => GroupFiltersSchema.parse({ subjects: ["기타"] })).toThrow();
    });

    it("schools 문자열 중 빈 문자열 포함되면 실패", () => {
      expect(() => GroupFiltersSchema.parse({ schools: [""] })).toThrow();
    });
  });
});

describe("CreateGroupInputSchema", () => {
  describe("정상 입력", () => {
    it("name · branch · filters 모두 주어지면 성공", () => {
      const r = CreateGroupInputSchema.parse({
        name: "대치 고2 전체",
        branch: "대치",
        filters: { grades: ["고2"], schools: [], subjects: [] },
      });
      expect(r.name).toBe("대치 고2 전체");
      expect(r.branch).toBe("대치");
      expect(r.filters.grades).toEqual(["고2"]);
    });

    it("filters 빈 객체 · 기본 빈 배열로 채워짐", () => {
      const r = CreateGroupInputSchema.parse({
        name: "전체 그룹",
        branch: "대치",
        filters: {},
      });
      expect(r.filters).toEqual({ grades: [], schools: [], subjects: [] });
    });
  });

  describe("경계값 · 실패", () => {
    it("name 빈 문자열 → 한글 에러 메시지 포함", () => {
      const parsed = CreateGroupInputSchema.safeParse({
        name: "",
        branch: "대치",
        filters: {},
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const msgs = parsed.error.issues.map((i) => i.message);
        expect(msgs.some((m) => m.includes("그룹명"))).toBe(true);
      }
    });

    it("name 41자 → 실패", () => {
      const longName = "가".repeat(41);
      const parsed = CreateGroupInputSchema.safeParse({
        name: longName,
        branch: "대치",
        filters: {},
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const msgs = parsed.error.issues.map((i) => i.message);
        expect(msgs.some((m) => m.includes("40자"))).toBe(true);
      }
    });

    it("branch 빈 문자열 → 실패", () => {
      const parsed = CreateGroupInputSchema.safeParse({
        name: "그룹",
        branch: "",
        filters: {},
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const msgs = parsed.error.issues.map((i) => i.message);
        expect(msgs.some((m) => m.includes("분원"))).toBe(true);
      }
    });

    it("name 40자 경계 · 성공", () => {
      const name40 = "가".repeat(40);
      const r = CreateGroupInputSchema.parse({
        name: name40,
        branch: "대치",
        filters: {},
      });
      expect(r.name.length).toBe(40);
    });
  });
});

describe("UpdateGroupInputSchema", () => {
  // Zod v4 의 uuid 포맷은 version 비트(1~8)를 엄격 검사. v4 형식 사용.
  const validId = "11111111-1111-4111-8111-111111111111";

  describe("정상 입력", () => {
    it("id + name 만 주는 부분 수정 성공", () => {
      const r = UpdateGroupInputSchema.parse({
        id: validId,
        name: "새 이름",
      });
      expect(r.id).toBe(validId);
      expect(r.name).toBe("새 이름");
      expect(r.filters).toBeUndefined();
    });

    it("id + filters 만 주는 부분 수정 성공", () => {
      const r = UpdateGroupInputSchema.parse({
        id: validId,
        filters: { grades: ["고3"], schools: [], subjects: [] },
      });
      expect(r.filters?.grades).toEqual(["고3"]);
    });
  });

  describe("경계값 · 실패", () => {
    it("id 가 UUID 형식이 아니면 실패(한글 메시지)", () => {
      const parsed = UpdateGroupInputSchema.safeParse({ id: "not-uuid" });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const msgs = parsed.error.issues.map((i) => i.message);
        expect(msgs.some((m) => m.includes("그룹 ID"))).toBe(true);
      }
    });
  });
});

describe("GroupListQuerySchema", () => {
  describe("기본값", () => {
    it("빈 객체 → q='' branch='' page=1", () => {
      const r = GroupListQuerySchema.parse({});
      expect(r.q).toBe("");
      expect(r.branch).toBe("");
      expect(r.page).toBe(1);
    });
  });

  describe("정상 입력 · coerce", () => {
    it("q · branch 텍스트, page 문자열 '2' → 숫자 2 로 강제", () => {
      const r = GroupListQuerySchema.parse({
        q: "대치",
        branch: "대치",
        page: "2",
      });
      expect(r.q).toBe("대치");
      expect(r.branch).toBe("대치");
      expect(r.page).toBe(2);
    });

    it("q · branch 양옆 공백은 trim", () => {
      const r = GroupListQuerySchema.parse({
        q: "  고2  ",
        branch: "  대치  ",
      });
      expect(r.q).toBe("고2");
      expect(r.branch).toBe("대치");
    });
  });

  describe("경계값", () => {
    it("page 가 0 이면 실패", () => {
      expect(() => GroupListQuerySchema.parse({ page: "0" })).toThrow();
    });

    it("page 가 음수면 실패", () => {
      expect(() => GroupListQuerySchema.parse({ page: "-1" })).toThrow();
    });
  });
});
