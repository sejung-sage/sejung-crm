import { describe, it, expect } from "vitest";
import {
  BYTE_LIMITS,
  CreateTemplateInputSchema,
  UpdateTemplateInputSchema,
  TemplateListQuerySchema,
} from "@/lib/schemas/template";

/**
 * F3-A · 템플릿 Zod 스키마 테스트.
 *
 * 정책:
 *   - name: 1~40자
 *   - body: 1~4000자
 *   - subject: LMS/ALIMTALK 에서 필수 (+ 40자 이내). SMS 는 null 허용.
 *   - is_ad 기본 false
 */

describe("BYTE_LIMITS 상수", () => {
  it("SMS=90, LMS=2000, ALIMTALK=1000", () => {
    expect(BYTE_LIMITS.SMS).toBe(90);
    expect(BYTE_LIMITS.LMS).toBe(2000);
    expect(BYTE_LIMITS.ALIMTALK).toBe(1000);
  });
});

describe("CreateTemplateInputSchema · 정상 입력", () => {
  it("SMS · subject 없음 → success + is_ad 기본 false", () => {
    const r = CreateTemplateInputSchema.parse({
      name: "결석자 안내",
      type: "SMS",
      body: "안녕하세요",
    });
    expect(r.name).toBe("결석자 안내");
    expect(r.type).toBe("SMS");
    expect(r.is_ad).toBe(false);
  });

  it("LMS · subject 있음 → success", () => {
    const r = CreateTemplateInputSchema.parse({
      name: "상담주간",
      type: "LMS",
      subject: "상담 주간 안내",
      body: "본문",
    });
    expect(r.subject).toBe("상담 주간 안내");
  });

  it("ALIMTALK · subject 있음 → success", () => {
    const r = CreateTemplateInputSchema.parse({
      name: "알림톡",
      type: "ALIMTALK",
      subject: "알림",
      body: "본문",
    });
    expect(r.type).toBe("ALIMTALK");
  });

  it("is_ad=true 명시", () => {
    const r = CreateTemplateInputSchema.parse({
      name: "특강",
      type: "SMS",
      body: "본문",
      is_ad: true,
    });
    expect(r.is_ad).toBe(true);
  });
});

describe("CreateTemplateInputSchema · name 검증", () => {
  it("이름 빈값 → 실패 + 한글 메시지", () => {
    const r = CreateTemplateInputSchema.safeParse({
      name: "",
      type: "SMS",
      body: "본문",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toContain("템플릿명");
    }
  });

  it("이름 공백만 → trim 후 빈값 · 실패", () => {
    const r = CreateTemplateInputSchema.safeParse({
      name: "   ",
      type: "SMS",
      body: "본문",
    });
    expect(r.success).toBe(false);
  });

  it("이름 41자 → 실패", () => {
    const r = CreateTemplateInputSchema.safeParse({
      name: "가".repeat(41),
      type: "SMS",
      body: "본문",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toContain("40자");
    }
  });

  it("이름 40자 경계 → 성공", () => {
    const r = CreateTemplateInputSchema.safeParse({
      name: "가".repeat(40),
      type: "SMS",
      body: "본문",
    });
    expect(r.success).toBe(true);
  });
});

describe("CreateTemplateInputSchema · body 검증", () => {
  it("본문 빈값 → 실패", () => {
    const r = CreateTemplateInputSchema.safeParse({
      name: "테스트",
      type: "SMS",
      body: "",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toContain("본문");
    }
  });

  it("본문 4001자 → 실패 (한글 메시지 '너무 깁니다')", () => {
    const r = CreateTemplateInputSchema.safeParse({
      name: "테스트",
      type: "SMS",
      body: "a".repeat(4001),
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes("너무"))).toBe(true);
    }
  });

  it("본문 4000자 경계 → 성공", () => {
    const r = CreateTemplateInputSchema.safeParse({
      name: "테스트",
      type: "SMS",
      body: "a".repeat(4000),
    });
    expect(r.success).toBe(true);
  });
});

describe("CreateTemplateInputSchema · subject 분기", () => {
  it("LMS · subject null → 실패", () => {
    const r = CreateTemplateInputSchema.safeParse({
      name: "LMS",
      type: "LMS",
      subject: null,
      body: "본문",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes("제목"))).toBe(true);
    }
  });

  it("ALIMTALK · subject 빈 문자열 → 실패", () => {
    const r = CreateTemplateInputSchema.safeParse({
      name: "알림톡",
      type: "ALIMTALK",
      subject: "",
      body: "본문",
    });
    expect(r.success).toBe(false);
  });

  it("SMS · subject null 허용", () => {
    const r = CreateTemplateInputSchema.safeParse({
      name: "SMS",
      type: "SMS",
      subject: null,
      body: "본문",
    });
    expect(r.success).toBe(true);
  });

  it("SMS · subject 없음(undefined) 허용 · 기본값 null", () => {
    const r = CreateTemplateInputSchema.parse({
      name: "SMS",
      type: "SMS",
      body: "본문",
    });
    expect(r.subject).toBeNull();
  });
});

describe("UpdateTemplateInputSchema", () => {
  it("id UUID 아님 → 실패", () => {
    const r = UpdateTemplateInputSchema.safeParse({
      id: "not-uuid",
      name: "수정",
      type: "SMS",
      body: "본문",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toContain("템플릿 ID");
    }
  });

  it("정상 uuid + 유효 payload → 성공", () => {
    const r = UpdateTemplateInputSchema.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      name: "수정",
      type: "SMS",
      body: "본문",
    });
    expect(r.success).toBe(true);
  });
});

describe("TemplateListQuerySchema · searchParams", () => {
  it("기본값: q='', page=1", () => {
    const r = TemplateListQuerySchema.parse({});
    expect(r.q).toBe("");
    expect(r.page).toBe(1);
  });

  it("page 문자열 → 숫자 coerce", () => {
    const r = TemplateListQuerySchema.parse({ page: "3" });
    expect(r.page).toBe(3);
  });

  it("잘못된 type('foo') → 실패", () => {
    const r = TemplateListQuerySchema.safeParse({ type: "foo" });
    expect(r.success).toBe(false);
  });

  it("type='LMS' 정상 파싱", () => {
    const r = TemplateListQuerySchema.parse({ type: "LMS" });
    expect(r.type).toBe("LMS");
  });
});
