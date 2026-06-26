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

describe("ComposeStep1Schema · 필터로 직접 발송", () => {
  it("정상 filters+branch → success", () => {
    const r = ComposeStep1Schema.safeParse({ filters: {}, branch: "대치" });
    expect(r.success).toBe(true);
  });

  it("빈 branch → 실패 + 한글 메시지", () => {
    const r = ComposeStep1Schema.safeParse({ filters: {}, branch: "" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/분원/);
    }
  });

  it("branch 누락 → 실패", () => {
    const r = ComposeStep1Schema.safeParse({ filters: {} });
    expect(r.success).toBe(false);
  });

  it("filters 누락 → 실패", () => {
    const r = ComposeStep1Schema.safeParse({ branch: "대치" });
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

  it("ALIMTALK 유형은 0059 이후 거부", () => {
    const r = ComposeStep2Schema.safeParse({
      type: "ALIMTALK",
      subject: "주간 안내",
      body: "본문",
      isAd: false,
    });
    expect(r.success).toBe(false);
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

  it("dedupeByPhone 기본값 false (생략 가능)", () => {
    const r = ComposeStep2Schema.safeParse({
      type: "SMS",
      body: "본문",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.dedupeByPhone).toBe(false);
    }
  });
});

describe("ComposeStep2Schema · {이름} ↔ 동일번호 1회 발송 상호배타", () => {
  // 같은 번호로 형제 N명을 1건으로 합칠 때 누구 이름을 쓸지 결정 불가 →
  // dedupe ON + 본문 {이름} 동시 사용 금지. {날짜} 는 전원 동일 값이라 허용.
  it("본문 {이름} + dedupeByPhone=true → 실패 (path dedupeByPhone, 한글 메시지)", () => {
    const r = ComposeStep2Schema.safeParse({
      type: "SMS",
      body: "{이름} 학부모님 안녕하세요",
      isAd: false,
      dedupeByPhone: true,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find(
        (i) => i.path[0] === "dedupeByPhone",
      );
      expect(issue).toBeDefined();
      expect(issue?.path).toEqual(["dedupeByPhone"]);
      expect(issue?.message).toMatch(/이름/);
      expect(issue?.message).toMatch(/동일번호 1회 발송/);
    }
  });

  it("본문 {이름} + dedupeByPhone=false → 통과 (dedupe OFF 면 개인화 허용)", () => {
    const r = ComposeStep2Schema.safeParse({
      type: "SMS",
      body: "{이름} 학부모님 안녕하세요",
      isAd: false,
      dedupeByPhone: false,
    });
    expect(r.success).toBe(true);
  });

  it("본문 {이름} + dedupeByPhone 생략(기본 false) → 통과", () => {
    const r = ComposeStep2Schema.safeParse({
      type: "SMS",
      body: "{이름} 학부모님 안녕하세요",
      isAd: false,
    });
    expect(r.success).toBe(true);
  });

  it("본문 {날짜}만 + dedupeByPhone=true → 통과 (전원 동일 값이라 충돌 없음)", () => {
    const r = ComposeStep2Schema.safeParse({
      type: "SMS",
      body: "{날짜} 주간테스트 안내드립니다",
      isAd: false,
      dedupeByPhone: true,
    });
    expect(r.success).toBe(true);
  });

  it("본문에 변수 없음 + dedupeByPhone=true → 통과", () => {
    const r = ComposeStep2Schema.safeParse({
      type: "SMS",
      body: "이번 주 정기 시험 안내입니다",
      isAd: false,
      dedupeByPhone: true,
    });
    expect(r.success).toBe(true);
  });

  it("본문 {이름}+{날짜} 동시 + dedupeByPhone=true → 실패 ({이름} 때문)", () => {
    const r = ComposeStep2Schema.safeParse({
      type: "SMS",
      body: "{이름} 학부모님, {날짜} 시험 안내",
      isAd: false,
      dedupeByPhone: true,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(
        r.error.issues.some((i) => i.path[0] === "dedupeByPhone"),
      ).toBe(true);
    }
  });

  it("LMS · 본문 {이름} + dedupeByPhone=true → 실패 (유형 무관 상호배타)", () => {
    const r = ComposeStep2Schema.safeParse({
      type: "LMS",
      subject: "주간 안내",
      body: "{이름} 학부모님께 안내드립니다",
      isAd: false,
      dedupeByPhone: true,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(
        r.error.issues.some((i) => i.path[0] === "dedupeByPhone"),
      ).toBe(true);
    }
  });
});

describe("ComposeStep2Schema · 발송 대상(학부모/학생) 선택 (0077)", () => {
  // 한 학생은 send_to_parent / send_to_student 선택에 따라 0~2 레그로 확장.
  // 둘 다 false 면 발송 레그 0개 → "최소 하나" refine 으로 즉시 한글 안내.
  // DB CHECK(chk_campaigns_send_target)가 최종 방어선이지만 폼 단에서 막는다.

  it("기본값: sendToParent=true / sendToStudent=false (둘 다 생략)", () => {
    const r = ComposeStep2Schema.safeParse({
      type: "SMS",
      body: "본문",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.sendToParent).toBe(true);
      expect(r.data.sendToStudent).toBe(false);
    }
  });

  it("sendToParent=true + sendToStudent=false → 통과 (학부모만)", () => {
    const r = ComposeStep2Schema.safeParse({
      type: "SMS",
      body: "본문",
      sendToParent: true,
      sendToStudent: false,
    });
    expect(r.success).toBe(true);
  });

  it("sendToParent=false + sendToStudent=true → 통과 (학생만)", () => {
    const r = ComposeStep2Schema.safeParse({
      type: "SMS",
      body: "본문",
      sendToParent: false,
      sendToStudent: true,
    });
    expect(r.success).toBe(true);
  });

  it("sendToParent=true + sendToStudent=true → 통과 (둘 다)", () => {
    const r = ComposeStep2Schema.safeParse({
      type: "SMS",
      body: "본문",
      sendToParent: true,
      sendToStudent: true,
    });
    expect(r.success).toBe(true);
  });

  it("sendToParent=false + sendToStudent=false → 실패 (path sendToParent, 한글 메시지)", () => {
    const r = ComposeStep2Schema.safeParse({
      type: "SMS",
      body: "본문",
      sendToParent: false,
      sendToStudent: false,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path[0] === "sendToParent");
      expect(issue).toBeDefined();
      expect(issue?.path).toEqual(["sendToParent"]);
      expect(issue?.message).toMatch(/발송 대상/);
      expect(issue?.message).toMatch(/최소 하나/);
    }
  });

  it("sendToStudent=false 만 명시(sendToParent 생략→기본 true) → 통과", () => {
    const r = ComposeStep2Schema.safeParse({
      type: "SMS",
      body: "본문",
      sendToStudent: false,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.sendToParent).toBe(true);
    }
  });

  it("sendToParent=false 만 명시(sendToStudent 생략→기본 false) → 실패 (둘 다 false)", () => {
    // sendToParent 를 명시적으로 끄고 sendToStudent 를 생략하면 기본 false →
    // 둘 다 false 가 되어 refine 에 걸린다.
    const r = ComposeStep2Schema.safeParse({
      type: "SMS",
      body: "본문",
      sendToParent: false,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(
        r.error.issues.some((i) => i.path[0] === "sendToParent"),
      ).toBe(true);
    }
  });

  it("발송 대상 둘 다 선택 + dedupeByPhone=true → 통과 (독립 토글)", () => {
    const r = ComposeStep2Schema.safeParse({
      type: "SMS",
      body: "정기 시험 안내입니다",
      sendToParent: true,
      sendToStudent: true,
      dedupeByPhone: true,
    });
    expect(r.success).toBe(true);
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
  const validStep1 = { filters: {}, branch: "대치" };
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

  it("step1 비정상(빈 branch) → 전체 실패", () => {
    const r = ComposeFinalSchema.safeParse({
      step1: { filters: {}, branch: "" },
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

  it("정상 step1(filters+branch) + step2 정상 → success", () => {
    const r = PreviewInputSchema.safeParse({
      step1: { filters: {}, branch: "대치" },
      step2: validStep2,
    });
    expect(r.success).toBe(true);
  });

  it("step1.branch 빈값 → 실패", () => {
    const r = PreviewInputSchema.safeParse({
      step1: { filters: {}, branch: "" },
      step2: validStep2,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/분원/);
    }
  });

  it("step2 본문 빈값 → success (미리보기는 본문 없어도 산출)", () => {
    // 미리보기는 수신자 수·비용 산출이 목적이라 본문이 비어도 동작해야 한다.
    // (본문 필수는 발송 시점 ComposeStep2Schema 에서만 강제.)
    const r = PreviewInputSchema.safeParse({
      step1: { filters: {}, branch: "대치" },
      step2: { type: "SMS", body: "", isAd: false },
    });
    expect(r.success).toBe(true);
  });

  it("step2 본문 누락(undefined) → success (기본 빈 문자열)", () => {
    const r = PreviewInputSchema.safeParse({
      step1: { filters: {}, branch: "대치" },
      step2: { type: "SMS", isAd: false },
    });
    expect(r.success).toBe(true);
  });

  it("LMS 인데 제목 없어도 미리보기는 success", () => {
    // 발송에선 LMS 제목 필수지만, 작성 도중 미리보기까지 막으면 안 됨.
    const r = PreviewInputSchema.safeParse({
      step1: { filters: {}, branch: "대치" },
      step2: { type: "LMS", body: "", isAd: false },
    });
    expect(r.success).toBe(true);
  });
});
