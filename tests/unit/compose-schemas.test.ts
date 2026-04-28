import { describe, it, expect } from "vitest";
import {
  ComposeStep1Schema,
  ComposeStep2Schema,
  ComposeStep3Schema,
  ComposeFinalSchema,
  TestSendInputSchema,
  PreviewInputSchema,
} from "@/lib/schemas/compose";

/**
 * F3 Part B · Compose 위저드 Zod 스키마.
 *
 * 외부 입력(폼/Server Action) 검증의 첫 방어선.
 * 메시지는 모두 한글이어야 하며 (CLAUDE.md 규약 #3) UI 노출에 그대로 사용된다.
 */

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

describe("ComposeStep1Schema · 그룹 선택", () => {
  it("정상 UUID → success", () => {
    const r = ComposeStep1Schema.safeParse({ groupId: VALID_UUID });
    expect(r.success).toBe(true);
  });

  it("빈 문자열 → 실패 + 한글 메시지", () => {
    const r = ComposeStep1Schema.safeParse({ groupId: "" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/그룹/);
    }
  });

  it("UUID 아님(\"not-uuid\") → 실패", () => {
    const r = ComposeStep1Schema.safeParse({ groupId: "not-uuid" });
    expect(r.success).toBe(false);
  });

  it("groupId 누락 → 실패", () => {
    const r = ComposeStep1Schema.safeParse({});
    expect(r.success).toBe(false);
  });
});

describe("ComposeStep2Schema · 본문/템플릿", () => {
  it("SMS 정상 + subject 미설정 → success", () => {
    const r = ComposeStep2Schema.safeParse({
      type: "SMS",
      body: "안녕하세요",
      isAd: false,
    });
    expect(r.success).toBe(true);
  });

  it("SMS · subject 명시적 null 도 success", () => {
    const r = ComposeStep2Schema.safeParse({
      type: "SMS",
      subject: null,
      body: "안녕",
      isAd: false,
    });
    expect(r.success).toBe(true);
  });

  it("LMS 인데 subject null → 실패 (한글 메시지)", () => {
    const r = ComposeStep2Schema.safeParse({
      type: "LMS",
      subject: null,
      body: "본문 길이는 충분",
      isAd: false,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/제목/);
    }
  });

  it("LMS 인데 subject 빈 문자열 → 실패", () => {
    const r = ComposeStep2Schema.safeParse({
      type: "LMS",
      subject: "",
      body: "본문",
      isAd: false,
    });
    expect(r.success).toBe(false);
  });

  it("LMS 인데 subject 미설정(undefined) → 실패", () => {
    const r = ComposeStep2Schema.safeParse({
      type: "LMS",
      body: "본문",
      isAd: false,
    });
    expect(r.success).toBe(false);
  });

  it("ALIMTALK + subject 정상 → success", () => {
    const r = ComposeStep2Schema.safeParse({
      type: "ALIMTALK",
      subject: "주간 안내",
      body: "본문",
      isAd: false,
    });
    expect(r.success).toBe(true);
  });

  it("body 빈값 → 실패", () => {
    const r = ComposeStep2Schema.safeParse({
      type: "SMS",
      body: "",
      isAd: false,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/본문/);
    }
  });

  it("body 4001자 → 실패 (max 4000)", () => {
    const r = ComposeStep2Schema.safeParse({
      type: "LMS",
      subject: "제목",
      body: "가".repeat(4001),
      isAd: false,
    });
    expect(r.success).toBe(false);
  });

  it("body 4000자 정확히 → success (경계)", () => {
    const r = ComposeStep2Schema.safeParse({
      type: "LMS",
      subject: "제목",
      body: "가".repeat(4000),
      isAd: false,
    });
    expect(r.success).toBe(true);
  });

  it("isAd 기본값 false (생략 가능)", () => {
    const r = ComposeStep2Schema.safeParse({
      type: "SMS",
      body: "본문",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.isAd).toBe(false);
    }
  });

  it("templateId 가 UUID 아님 → 실패", () => {
    const r = ComposeStep2Schema.safeParse({
      templateId: "not-a-uuid",
      type: "SMS",
      body: "본문",
      isAd: false,
    });
    expect(r.success).toBe(false);
  });

  it("subject 41자 → 실패", () => {
    const r = ComposeStep2Schema.safeParse({
      type: "LMS",
      subject: "가".repeat(41),
      body: "본문",
      isAd: false,
    });
    expect(r.success).toBe(false);
  });
});

describe("ComposeStep3Schema · 캠페인 제목", () => {
  it("title 정상 → success", () => {
    const r = ComposeStep3Schema.safeParse({ title: "4월 주간테스트 안내" });
    expect(r.success).toBe(true);
  });

  it("title 빈값 → 실패", () => {
    const r = ComposeStep3Schema.safeParse({ title: "" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/제목/);
    }
  });

  it("title 공백만 → 실패 (trim 후 빈값)", () => {
    const r = ComposeStep3Schema.safeParse({ title: "   " });
    expect(r.success).toBe(false);
  });

  it("title 60자 정확히 → success", () => {
    const r = ComposeStep3Schema.safeParse({ title: "가".repeat(60) });
    expect(r.success).toBe(true);
  });

  it("title 61자 → 실패", () => {
    const r = ComposeStep3Schema.safeParse({ title: "가".repeat(61) });
    expect(r.success).toBe(false);
  });
});

describe("ComposeFinalSchema · 즉시 vs 예약", () => {
  const validStep1 = { groupId: VALID_UUID };
  const validStep2 = { type: "SMS" as const, body: "본문", isAd: false };
  const validStep3 = { title: "캠페인" };

  it("step1+2+3 정상 + scheduleAt 미설정 → success(즉시)", () => {
    const r = ComposeFinalSchema.safeParse({
      step1: validStep1,
      step2: validStep2,
      step3: validStep3,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.scheduleAt).toBeUndefined();
    }
  });

  it("scheduleAt ISO 형식 → success", () => {
    const r = ComposeFinalSchema.safeParse({
      step1: validStep1,
      step2: validStep2,
      step3: validStep3,
      scheduleAt: "2026-12-31T15:00:00.000Z",
    });
    expect(r.success).toBe(true);
  });

  it("scheduleAt 잘못된 형식 → 실패 + 한글 메시지", () => {
    const r = ComposeFinalSchema.safeParse({
      step1: validStep1,
      step2: validStep2,
      step3: validStep3,
      scheduleAt: "내일 오후 3시",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/시각|형식|올바르지/);
    }
  });

  it("step1 비정상(빈 groupId) → 전체 실패", () => {
    const r = ComposeFinalSchema.safeParse({
      step1: { groupId: "" },
      step2: validStep2,
      step3: validStep3,
    });
    expect(r.success).toBe(false);
  });

  it("step3 비정상(빈 title) → 전체 실패", () => {
    const r = ComposeFinalSchema.safeParse({
      step1: validStep1,
      step2: validStep2,
      step3: { title: "" },
    });
    expect(r.success).toBe(false);
  });
});

describe("TestSendInputSchema · 테스트 발송 번호", () => {
  const validStep2 = { type: "SMS" as const, body: "본문", isAd: false };

  it("정상 휴대폰 (01012345678) → success", () => {
    const r = TestSendInputSchema.safeParse({
      step2: validStep2,
      toPhone: "01012345678",
    });
    expect(r.success).toBe(true);
  });

  it("일반 전화 (021234567) → 실패", () => {
    const r = TestSendInputSchema.safeParse({
      step2: validStep2,
      toPhone: "021234567",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/휴대폰/);
    }
  });

  it("하이픈 포함 (010-1234-5678) → 실패 (정규식이 하이픈 없는 형식만 허용)", () => {
    const r = TestSendInputSchema.safeParse({
      step2: validStep2,
      toPhone: "010-1234-5678",
    });
    expect(r.success).toBe(false);
  });

  it("빈 toPhone → 실패", () => {
    const r = TestSendInputSchema.safeParse({
      step2: validStep2,
      toPhone: "",
    });
    expect(r.success).toBe(false);
  });

  it("국제번호 prefix (+8210...) → 실패", () => {
    const r = TestSendInputSchema.safeParse({
      step2: validStep2,
      toPhone: "+821012345678",
    });
    expect(r.success).toBe(false);
  });

  it("step2 가 비정상이면 전체 실패", () => {
    const r = TestSendInputSchema.safeParse({
      step2: { type: "LMS", body: "본문", isAd: false }, // subject 누락
      toPhone: "01012345678",
    });
    expect(r.success).toBe(false);
  });
});

describe("PreviewInputSchema · 미리보기 입력", () => {
  const validStep2 = { type: "SMS" as const, body: "본문", isAd: false };

  it("정상 groupId(UUID) + step2 정상 → success", () => {
    const r = PreviewInputSchema.safeParse({
      groupId: VALID_UUID,
      step2: validStep2,
    });
    expect(r.success).toBe(true);
  });

  it("groupId UUID 아님 → 실패", () => {
    const r = PreviewInputSchema.safeParse({
      groupId: "dev-group-1",
      step2: validStep2,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/그룹/);
    }
  });

  it("step2 본문 빈값 → 실패", () => {
    const r = PreviewInputSchema.safeParse({
      groupId: VALID_UUID,
      step2: { type: "SMS", body: "", isAd: false },
    });
    expect(r.success).toBe(false);
  });
});
