import { describe, it, expect } from "vitest";
import {
  BranchSchema,
  GradeSchema,
  StudentStatusSchema,
  PhoneSchema,
  UserRoleSchema,
} from "@/lib/schemas/common";
import { parseStudentsSearchParams } from "@/lib/schemas/student";

describe("Zod · common schemas", () => {
  it("BranchSchema · 비어있는 문자열은 거부", () => {
    expect(() => BranchSchema.parse("")).toThrow();
    expect(BranchSchema.parse("대치")).toBe("대치");
  });

  it("GradeSchema · 1/2/3 만 허용", () => {
    expect(GradeSchema.parse(2)).toBe(2);
    expect(() => GradeSchema.parse(4)).toThrow();
    expect(() => GradeSchema.parse(0)).toThrow();
  });

  it("StudentStatusSchema · 4개 값만 허용", () => {
    expect(StudentStatusSchema.parse("재원생")).toBe("재원생");
    expect(StudentStatusSchema.parse("수강이력자")).toBe("수강이력자");
    expect(() => StudentStatusSchema.parse("휴원")).toThrow();
  });

  it("UserRoleSchema · 4단계", () => {
    expect(UserRoleSchema.parse("master")).toBe("master");
    expect(UserRoleSchema.parse("manager")).toBe("manager");
    expect(() => UserRoleSchema.parse("superuser")).toThrow();
  });

  describe("PhoneSchema", () => {
    it("010-1234-5678 허용", () => {
      expect(PhoneSchema.parse("010-1234-5678")).toBe("010-1234-5678");
    });
    it("01012345678 허용", () => {
      expect(PhoneSchema.parse("01012345678")).toBe("01012345678");
    });
    it("유효하지 않은 형식 거부", () => {
      expect(() => PhoneSchema.parse("abc")).toThrow();
      expect(() => PhoneSchema.parse("020-1234-5678")).toThrow();
    });
  });
});

describe("parseStudentsSearchParams · URL → 입력", () => {
  it("빈 객체 → 기본값", () => {
    const r = parseStudentsSearchParams({});
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(50);
    expect(r.grades).toEqual([]);
    expect(r.search).toBe("");
  });

  it("단일 grade 문자열 → 배열로", () => {
    const r = parseStudentsSearchParams({ grade: "2" });
    expect(r.grades).toEqual([2]);
  });

  it("grade 배열 · 복수 선택", () => {
    const r = parseStudentsSearchParams({ grade: ["1", "3"] });
    expect(r.grades).toEqual([1, 3]);
  });

  it("잘못된 grade 값은 필터링됨", () => {
    const r = parseStudentsSearchParams({ grade: ["5", "2"] });
    expect(r.grades).toEqual([2]);
  });

  it("track · status 필터링 동작", () => {
    const r = parseStudentsSearchParams({
      track: "문과",
      status: ["재원생", "알수없음"],
    });
    expect(r.tracks).toEqual(["문과"]);
    expect(r.statuses).toEqual(["재원생"]);
  });

  it("q · search 매핑", () => {
    const r = parseStudentsSearchParams({ q: "김민준" });
    expect(r.search).toBe("김민준");
  });

  it("page · size 숫자 강제", () => {
    const r = parseStudentsSearchParams({ page: "3", size: "100" });
    expect(r.page).toBe(3);
    expect(r.pageSize).toBe(100);
  });
});
