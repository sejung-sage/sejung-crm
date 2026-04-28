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

  it("GradeSchema · 9종 정규화 enum 만 허용 (0012 마이그레이션)", () => {
    // 정규화된 9종: 중1/중2/중3/고1/고2/고3/재수/졸업/미정
    expect(GradeSchema.parse("고2")).toBe("고2");
    expect(GradeSchema.parse("중3")).toBe("중3");
    expect(GradeSchema.parse("재수")).toBe("재수");
    expect(GradeSchema.parse("졸업")).toBe("졸업");
    expect(GradeSchema.parse("미정")).toBe("미정");
    // 구버전 정수 값은 더이상 허용 안 함
    expect(() => GradeSchema.parse(2)).toThrow();
    expect(() => GradeSchema.parse("4")).toThrow();
    expect(() => GradeSchema.parse("고4")).toThrow();
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

  it("단일 grade 문자열 → 배열로 (정규화 enum)", () => {
    const r = parseStudentsSearchParams({ grade: "고2" });
    expect(r.grades).toEqual(["고2"]);
  });

  it("grade 배열 · 복수 선택", () => {
    const r = parseStudentsSearchParams({ grade: ["고1", "고3"] });
    expect(r.grades).toEqual(["고1", "고3"]);
  });

  it("잘못된 grade 값(예: 구버전 정수)은 화이트리스트 필터링됨", () => {
    // 0012 이후 grade 는 enum 문자열만 허용. "5" 같은 원값은 필터링.
    const r = parseStudentsSearchParams({ grade: ["5", "고2"] });
    expect(r.grades).toEqual(["고2"]);
  });

  it("schoolLevel · ?level=중&level=고 파싱", () => {
    const r = parseStudentsSearchParams({ level: ["중", "고"] });
    expect(r.schoolLevels).toEqual(["중", "고"]);
  });

  it("includeHidden · ?include_hidden=1 → true", () => {
    const r = parseStudentsSearchParams({ include_hidden: "1" });
    expect(r.includeHidden).toBe(true);
  });

  it("includeHidden 기본값 · false", () => {
    const r = parseStudentsSearchParams({});
    expect(r.includeHidden).toBe(false);
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
