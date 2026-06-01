import { describe, it, expect } from "vitest";
import {
  SeminarStatusSchema,
  SignupStatusSchema,
  SignupForSeminarStatusSchema,
  ParentPhoneSchema,
  StudentNameSchema,
  CreateSeminarInputSchema,
  UpdateSeminarInputSchema,
  SubmitSignupInputSchema,
  CancelSignupInputSchema,
  ChangeSeminarStatusInputSchema,
  SeminarListQuerySchema,
} from "@/lib/schemas/seminar";
import {
  SEMINAR_LINK_TOKEN_LENGTH,
  generateLinkToken,
} from "@/lib/seminars/generate-link-token";

/**
 * 설명회 신청 시스템 (0080) · Zod 스키마 & 토큰 헬퍼 단위 테스트.
 *
 * 구조: describe(스키마) → describe(시나리오) → it(케이스).
 */

describe("SeminarStatusSchema", () => {
  it("DB CHECK 4종만 허용", () => {
    expect(SeminarStatusSchema.parse("open")).toBe("open");
    expect(SeminarStatusSchema.parse("closed")).toBe("closed");
    expect(SeminarStatusSchema.parse("ended")).toBe("ended");
    expect(SeminarStatusSchema.parse("cancelled")).toBe("cancelled");
    expect(() => SeminarStatusSchema.parse("active")).toThrow();
    expect(() => SeminarStatusSchema.parse("")).toThrow();
  });
});

describe("SignupStatusSchema", () => {
  it("signed/cancelled 만 허용 (대기명단 Phase 2)", () => {
    expect(SignupStatusSchema.parse("signed")).toBe("signed");
    expect(SignupStatusSchema.parse("cancelled")).toBe("cancelled");
    expect(() => SignupStatusSchema.parse("active")).toThrow();
    expect(() => SignupStatusSchema.parse("waiting")).toThrow();
  });
});

describe("SignupForSeminarStatusSchema", () => {
  it("RPC 7종 반환 status 모두 허용", () => {
    for (const s of [
      "signed",
      "duplicate",
      "closed",
      "ended",
      "cancelled",
      "invalid",
      "out_of_window",
    ]) {
      expect(SignupForSeminarStatusSchema.parse(s)).toBe(s);
    }
  });
});

describe("ParentPhoneSchema", () => {
  it("하이픈/공백 제거 후 숫자만 반환", () => {
    expect(ParentPhoneSchema.parse("010-1234-5678")).toBe("01012345678");
    expect(ParentPhoneSchema.parse("010 1234 5678")).toBe("01012345678");
    expect(ParentPhoneSchema.parse(" 01012345678 ")).toBe("01012345678");
  });
  it("digits 11자 초과 거부 (+82 prefix 포함 12자리)", () => {
    expect(() => ParentPhoneSchema.parse("+821012345678")).toThrow();
  });
  it("digits 8자 미만 거부", () => {
    expect(() => ParentPhoneSchema.parse("010-12")).toThrow();
  });
  it("빈 문자열 거부", () => {
    expect(() => ParentPhoneSchema.parse("")).toThrow();
  });
});

describe("StudentNameSchema", () => {
  it("trim 후 1~40자 허용", () => {
    expect(StudentNameSchema.parse(" 김민준 ")).toBe("김민준");
    expect(StudentNameSchema.parse("A".repeat(40))).toBe("A".repeat(40));
  });
  it("빈 문자열/공백만/40자 초과 거부", () => {
    expect(() => StudentNameSchema.parse("")).toThrow();
    expect(() => StudentNameSchema.parse("   ")).toThrow();
    expect(() => StudentNameSchema.parse("A".repeat(41))).toThrow();
  });
});

describe("CreateSeminarInputSchema", () => {
  it("최소 입력(name+branch) 만으로 통과 + 빈 문자열은 null 로 정규화", () => {
    const r = CreateSeminarInputSchema.parse({
      name: "2026 휘문 1학년 입시설명회",
      branch: "대치",
      description: "",
      held_at: "",
      venue: "",
      capacity: null,
      signup_opens_at: "",
      signup_closes_at: "",
    });
    expect(r.name).toBe("2026 휘문 1학년 입시설명회");
    expect(r.description).toBeNull();
    expect(r.held_at).toBeNull();
    expect(r.venue).toBeNull();
    expect(r.capacity).toBeNull();
    expect(r.signup_opens_at).toBeNull();
    expect(r.signup_closes_at).toBeNull();
  });

  it("정원 0 이하 거부", () => {
    expect(() =>
      CreateSeminarInputSchema.parse({
        name: "x",
        branch: "대치",
        description: null,
        held_at: null,
        venue: null,
        capacity: 0,
        signup_opens_at: null,
        signup_closes_at: null,
      }),
    ).toThrow();
  });

  it("signup_closes_at < signup_opens_at 거부", () => {
    expect(() =>
      CreateSeminarInputSchema.parse({
        name: "x",
        branch: "대치",
        description: null,
        held_at: null,
        venue: null,
        capacity: null,
        signup_opens_at: "2026-06-10T10:00:00Z",
        signup_closes_at: "2026-06-09T10:00:00Z",
      }),
    ).toThrow();
  });

  it("이름 빈 문자열 거부 / 80자 초과 거부", () => {
    expect(() =>
      CreateSeminarInputSchema.parse({
        name: "",
        branch: "대치",
        description: null,
        held_at: null,
        venue: null,
        capacity: null,
        signup_opens_at: null,
        signup_closes_at: null,
      }),
    ).toThrow();
    expect(() =>
      CreateSeminarInputSchema.parse({
        name: "A".repeat(81),
        branch: "대치",
        description: null,
        held_at: null,
        venue: null,
        capacity: null,
        signup_opens_at: null,
        signup_closes_at: null,
      }),
    ).toThrow();
  });
});

describe("UpdateSeminarInputSchema", () => {
  it("id + 부분 필드만 허용", () => {
    const r = UpdateSeminarInputSchema.parse({
      id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      name: "수정된 제목",
    });
    expect(r.id).toBe("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d");
    expect(r.name).toBe("수정된 제목");
  });

  it("UUID 가 아니면 거부", () => {
    expect(() =>
      UpdateSeminarInputSchema.parse({
        id: "not-a-uuid",
        name: "x",
      }),
    ).toThrow();
  });

  it("두 신청 시각이 모두 들어왔을 때만 cross check", () => {
    // 둘 중 하나만 들어오면 통과
    expect(() =>
      UpdateSeminarInputSchema.parse({
        id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
        signup_opens_at: "2026-06-10T10:00:00Z",
      }),
    ).not.toThrow();
    // 둘 다 들어오고 역순이면 실패
    expect(() =>
      UpdateSeminarInputSchema.parse({
        id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
        signup_opens_at: "2026-06-10T10:00:00Z",
        signup_closes_at: "2026-06-09T10:00:00Z",
      }),
    ).toThrow();
  });
});

describe("SubmitSignupInputSchema", () => {
  it("정상 입력 + parent_phone digits 정규화", () => {
    const r = SubmitSignupInputSchema.parse({
      student_name: "김민준",
      parent_phone: "010-1234-5678",
      consent: true,
    });
    expect(r.student_name).toBe("김민준");
    expect(r.parent_phone).toBe("01012345678");
    expect(r.consent).toBe(true);
  });

  it("consent=false 거부", () => {
    expect(() =>
      SubmitSignupInputSchema.parse({
        student_name: "김민준",
        parent_phone: "010-1234-5678",
        consent: false,
      }),
    ).toThrow();
  });

  it("학생 이름 빈/공백만 거부", () => {
    expect(() =>
      SubmitSignupInputSchema.parse({
        student_name: "   ",
        parent_phone: "010-1234-5678",
        consent: true,
      }),
    ).toThrow();
  });

  it("전화번호 너무 짧으면 거부", () => {
    expect(() =>
      SubmitSignupInputSchema.parse({
        student_name: "김민준",
        parent_phone: "010-12",
        consent: true,
      }),
    ).toThrow();
  });
});

describe("CancelSignupInputSchema", () => {
  it("UUID 만 허용", () => {
    expect(
      CancelSignupInputSchema.parse({
        signup_id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      }).signup_id,
    ).toBe("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d");
    expect(() => CancelSignupInputSchema.parse({ signup_id: "x" })).toThrow();
  });
});

describe("ChangeSeminarStatusInputSchema", () => {
  it("status enum 4종만 허용", () => {
    const r = ChangeSeminarStatusInputSchema.parse({
      seminar_id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      status: "cancelled",
    });
    expect(r.status).toBe("cancelled");
    expect(() =>
      ChangeSeminarStatusInputSchema.parse({
        seminar_id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
        status: "active",
      }),
    ).toThrow();
  });
});

describe("SeminarListQuerySchema", () => {
  it("빈 객체 → 모든 필드 빈 문자열 기본", () => {
    const r = SeminarListQuerySchema.parse({});
    expect(r).toEqual({ branch: "", status: "", q: "" });
  });
  it("status 빈 문자열 또는 enum 만 허용", () => {
    expect(SeminarListQuerySchema.parse({ status: "open" }).status).toBe("open");
    expect(SeminarListQuerySchema.parse({ status: "" }).status).toBe("");
    expect(() => SeminarListQuerySchema.parse({ status: "bogus" })).toThrow();
  });
});

describe("generateLinkToken / SEMINAR_LINK_TOKEN_LENGTH", () => {
  it("길이 상수 = 12", () => {
    expect(SEMINAR_LINK_TOKEN_LENGTH).toBe(12);
  });
  it("정확히 12자, URL-safe 문자만 사용", () => {
    for (let i = 0; i < 200; i++) {
      const t = generateLinkToken();
      expect(t.length).toBe(12);
      expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
  it("연속 호출 시 충돌 없음 (200건 샘플)", () => {
    const set = new Set<string>();
    for (let i = 0; i < 200; i++) set.add(generateLinkToken());
    expect(set.size).toBe(200);
  });
});
