import { describe, it, expect } from "vitest";
import {
  GroupFiltersSchema,
  CreateGroupInputSchema,
  UpdateGroupInputSchema,
  GroupListQuerySchema,
  ClassPrefillFilterSchema,
  isLapsedStudent,
} from "@/lib/schemas/group";
import { StudentStatusSchema } from "@/lib/schemas/common";
import type { StudentStatus } from "@/types/database";

/**
 * F2 · 발송 그룹 Zod 스키마 단위 테스트.
 *
 * 구조: describe(스키마) → describe(시나리오) → describe(경계값).
 */

describe("GroupFiltersSchema", () => {
  describe("정상 입력", () => {
    it("빈 객체 · 모든 필드 기본값(빈 배열) 적용", () => {
      const r = GroupFiltersSchema.parse({});
      expect(r).toEqual({ grades: [], schools: [], subjects: [], regions: [], statuses: [], includeStudentIds: [], excludeStudentIds: [], excludeSchools: [], excludeClassIds: [], unmappedSchool: false, mappedSchool: false });
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

    it("subjects 에 enum 외 값('역사')이 섞이면 실패", () => {
      expect(() => GroupFiltersSchema.parse({ subjects: ["역사"] })).toThrow();
    });

    it("schools 문자열 중 빈 문자열 포함되면 실패", () => {
      expect(() => GroupFiltersSchema.parse({ schools: [""] })).toThrow();
    });
  });

  describe("excludeSchools / excludeClassIds (학교·강좌 제외 2026-05-27)", () => {
    // Zod v4 의 uuid 포맷은 version 비트(1~8)를 엄격 검사. v4 형식 사용.
    const validClassId = "44444444-4444-4444-8444-444444444444";

    describe("정상 입력", () => {
      it("excludeSchools 학교명 배열 성공", () => {
        const r = GroupFiltersSchema.parse({
          excludeSchools: ["휘문고", "단대부고"],
        });
        expect(r.excludeSchools).toEqual(["휘문고", "단대부고"]);
      });

      it("excludeClassIds UUID 배열 성공", () => {
        const r = GroupFiltersSchema.parse({
          excludeClassIds: [validClassId],
        });
        expect(r.excludeClassIds).toEqual([validClassId]);
      });

      it("excludeSchools 양옆 공백은 trim", () => {
        const r = GroupFiltersSchema.parse({
          excludeSchools: ["  휘문고  "],
        });
        expect(r.excludeSchools).toEqual(["휘문고"]);
      });
    });

    describe("백워드 호환 · 두 키 없는 옛 그룹 JSONB", () => {
      it("excludeSchools / excludeClassIds 키가 없으면 빈 배열로 채워진다", () => {
        // 0027(2026-05-27) 이전 저장된 옛 그룹 JSONB 시뮬레이션.
        const oldGroupJsonb = {
          grades: ["고2"],
          schools: ["휘문고"],
          subjects: ["수학"],
        };
        const r = GroupFiltersSchema.parse(oldGroupJsonb);
        expect(r.excludeSchools).toEqual([]);
        expect(r.excludeClassIds).toEqual([]);
        // 기존 필드는 그대로 보존
        expect(r.grades).toEqual(["고2"]);
        expect(r.schools).toEqual(["휘문고"]);
      });

      it("완전히 빈 객체도 두 키가 빈 배열로 채워진다", () => {
        const r = GroupFiltersSchema.parse({});
        expect(r.excludeSchools).toEqual([]);
        expect(r.excludeClassIds).toEqual([]);
      });
    });

    describe("경계값 · 유효성 거부", () => {
      it("excludeClassIds 에 비-UUID 값이 섞이면 실패", () => {
        expect(() =>
          GroupFiltersSchema.parse({ excludeClassIds: ["not-a-uuid"] }),
        ).toThrow();
      });

      it("excludeClassIds 에 빈 문자열이 섞이면 실패", () => {
        expect(() =>
          GroupFiltersSchema.parse({ excludeClassIds: [""] }),
        ).toThrow();
      });

      it("excludeSchools 에 빈 문자열이 섞이면 실패", () => {
        expect(() =>
          GroupFiltersSchema.parse({ excludeSchools: [""] }),
        ).toThrow();
      });

      it("excludeSchools 41자 학교명은 실패(max 40)", () => {
        expect(() =>
          GroupFiltersSchema.parse({ excludeSchools: ["가".repeat(41)] }),
        ).toThrow();
      });
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
      expect(r.filters).toEqual({ grades: [], schools: [], subjects: [], regions: [], statuses: [], includeStudentIds: [], excludeStudentIds: [], excludeSchools: [], excludeClassIds: [], unmappedSchool: false, mappedSchool: false });
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

/**
 * "종강 강좌 → 다음 시즌 미등록(이탈) 추적" (박은주 부원장 2026-05-27)
 * prefill 이탈 판정의 단일 술어. status !== '재원생' 이면 이탈 후보.
 * page prefill 과 class-lapsed-panel 카운트가 이 술어를 공유하므로,
 * StudentStatus 4종 전수 + 임의 비정상 입력까지 고정한다.
 */
describe("isLapsedStudent · 이탈 판정 단일 술어", () => {
  describe("재원생(이탈 아님)", () => {
    it("'재원생' → false (진행 중 수강 보유 → 다음 시즌도 다니는 중)", () => {
      expect(isLapsedStudent("재원생")).toBe(false);
    });
  });

  describe("이탈 후보(재원생 아님)", () => {
    it("'수강이력자' → true", () => {
      expect(isLapsedStudent("수강이력자")).toBe(true);
    });

    it("'수강 x' → true", () => {
      expect(isLapsedStudent("수강 x")).toBe(true);
    });

    it("'탈퇴' → true (명단엔 포함, 발송 시점 안전 가드가 별도 제외)", () => {
      expect(isLapsedStudent("탈퇴")).toBe(true);
    });
  });

  describe("StudentStatus enum 4종 전수 검증", () => {
    it("'재원생' 만 false, 나머지 3종은 모두 true", () => {
      // StudentStatusSchema(공통 enum) 를 단일 소스로 순회 — enum 변경 시 자동 추종.
      const allStatuses = StudentStatusSchema.options;
      expect(allStatuses).toHaveLength(4);

      const result = Object.fromEntries(
        allStatuses.map((s) => [s, isLapsedStudent(s)]),
      );
      expect(result).toEqual({
        재원생: false,
        수강이력자: true,
        "수강 x": true,
        탈퇴: true,
      });
    });

    it("타입 레벨 StudentStatus 4종도 동일 결과 (database.ts 와 enum 일치 확인)", () => {
      const typed: ReadonlyArray<StudentStatus> = [
        "재원생",
        "수강이력자",
        "수강 x",
        "탈퇴",
      ];
      const lapsedCount = typed.filter((s) => isLapsedStudent(s)).length;
      // 재원생 1종만 비-이탈 → 3종 이탈
      expect(lapsedCount).toBe(3);
    });
  });

  describe("경계 · 비정상 입력 (술어는 순수 string 비교)", () => {
    it("빈 문자열 → true (재원생이 아니므로)", () => {
      expect(isLapsedStudent("")).toBe(true);
    });

    it("알 수 없는 값 'unknown' → true", () => {
      expect(isLapsedStudent("unknown")).toBe(true);
    });
  });
});

/**
 * /groups/new?class=<id>&filter=... 의 filter 파라미터 스키마.
 * 미지정/오타/빈값/부적합 타입은 모두 'all' 로 폴백(.catch) — 강좌 prefill 의
 * 기본 동작(전체 수강생)이 안전 기본이 되도록.
 */
describe("ClassPrefillFilterSchema · prefill filter 폴백", () => {
  describe("유효 값은 그대로 통과", () => {
    it("'all' → 'all'", () => {
      expect(ClassPrefillFilterSchema.parse("all")).toBe("all");
    });

    it("'lapsed' → 'lapsed'", () => {
      expect(ClassPrefillFilterSchema.parse("lapsed")).toBe("lapsed");
    });
  });

  describe("비유효 값은 'all' 로 폴백 (.catch)", () => {
    it("빈 문자열 '' → 'all'", () => {
      expect(ClassPrefillFilterSchema.parse("")).toBe("all");
    });

    it("오타 'lapse' → 'all'", () => {
      expect(ClassPrefillFilterSchema.parse("lapse")).toBe("all");
    });

    it("대문자 'LAPSED' (대소문자 구분) → 'all'", () => {
      expect(ClassPrefillFilterSchema.parse("LAPSED")).toBe("all");
    });

    it("undefined (파라미터 미지정) → 'all'", () => {
      expect(ClassPrefillFilterSchema.parse(undefined)).toBe("all");
    });

    it("null → 'all'", () => {
      expect(ClassPrefillFilterSchema.parse(null)).toBe("all");
    });

    it("배열 ['lapsed'] (searchParams 중복 키) → 'all'", () => {
      expect(ClassPrefillFilterSchema.parse(["lapsed"])).toBe("all");
    });

    it("숫자 1 (부적합 타입) → 'all'", () => {
      expect(ClassPrefillFilterSchema.parse(1)).toBe("all");
    });
  });

  describe("safeParse 도 항상 success (catch 라 throw 없음)", () => {
    it("오타 입력이어도 success=true, data='all'", () => {
      const r = ClassPrefillFilterSchema.safeParse("xxx");
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data).toBe("all");
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
