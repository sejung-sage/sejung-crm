import { describe, it, expect, beforeEach } from "vitest";
import {
  previewAction,
  testSendAction,
  sendNowAction,
  scheduleAction,
} from "@/app/(features)/compose/actions";
import { resendFailedAction } from "@/app/(features)/campaigns/actions";

/**
 * F3 Part B · Compose Server Actions dev-seed 가드.
 *
 * 정책 (compose/actions.ts 헤더):
 *   - previewAction: dev-seed 모드에서도 동작 (UI 가 카운트/비용을 계속 보여줘야 함)
 *   - testSend / sendNow / schedule / resendFailed: dev-seed 차단
 *
 * 모든 Action 결과는 한국어 메시지를 가진 discriminated union.
 *
 * NOTE: "use server" 파일은 vitest 노드 환경에서 일반 모듈로 import 가능
 *   (group/template-actions-guards.test.ts 가 동일 패턴으로 통과 중).
 */

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

const validStep2Sms = {
  type: "SMS" as const,
  body: "안녕하세요",
  isAd: false,
};

describe("previewAction · dev-seed 에서도 정상 동작", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("스키마 위반(빈 groupId) → failed + 한글 메시지", async () => {
    const r = await previewAction({
      groupId: "",
      step2: validStep2Sms,
    });
    expect(r.status).toBe("failed");
    if (r.status === "failed") {
      expect(r.reason).toBeTruthy();
    }
  });

  it("UUID 형식이지만 미존재 그룹 → failed (한글 메시지)", async () => {
    const r = await previewAction({
      groupId: VALID_UUID,
      step2: validStep2Sms,
    });
    // dev-seed 환경에서 미존재 그룹 → previewRecipients throw → failed
    expect(r.status).toBe("failed");
    if (r.status === "failed") {
      expect(r.reason).toMatch(/그룹|존재/);
    }
  });
});

describe("testSendAction · dev-seed 차단", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("정상 입력 → dev_seed_mode", async () => {
    const r = await testSendAction({
      step2: validStep2Sms,
      toPhone: "01012345678",
    });
    expect(r.status).toBe("dev_seed_mode");
  });

  it("스키마 위반(잘못된 폰 형식) → failed (스키마가 dev-seed 보다 먼저)", async () => {
    const r = await testSendAction({
      step2: validStep2Sms,
      toPhone: "021234567",
    });
    expect(r.status).toBe("failed");
    if (r.status === "failed") {
      expect(r.reason).toMatch(/휴대폰/);
    }
  });
});

describe("sendNowAction · dev-seed 차단", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("정상 입력 → dev_seed_mode", async () => {
    const r = await sendNowAction({
      step1: { groupId: VALID_UUID },
      step2: validStep2Sms,
      step3: { title: "캠페인" },
    });
    expect(r.status).toBe("dev_seed_mode");
  });

  it("scheduleAt 가 들어있으면 dev_seed_mode 가 아니라 'scheduleAction 으로 호출' failed", async () => {
    const r = await sendNowAction({
      step1: { groupId: VALID_UUID },
      step2: validStep2Sms,
      step3: { title: "캠페인" },
      scheduleAt: "2027-01-01T00:00:00.000Z",
    });
    expect(r.status).toBe("failed");
    if (r.status === "failed") {
      expect(r.reason).toMatch(/예약|schedule/i);
    }
  });

  it("스키마 위반(빈 title) → failed", async () => {
    const r = await sendNowAction({
      step1: { groupId: VALID_UUID },
      step2: validStep2Sms,
      step3: { title: "" },
    });
    expect(r.status).toBe("failed");
  });
});

describe("scheduleAction · dev-seed 차단", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("정상 + 미래 시각 → dev_seed_mode", async () => {
    const r = await scheduleAction({
      step1: { groupId: VALID_UUID },
      step2: validStep2Sms,
      step3: { title: "캠페인" },
      scheduleAt: "2099-01-01T00:00:00.000Z",
    });
    expect(r.status).toBe("dev_seed_mode");
  });

  it("scheduleAt 미설정 → failed (예약 시각 누락)", async () => {
    const r = await scheduleAction({
      step1: { groupId: VALID_UUID },
      step2: validStep2Sms,
      step3: { title: "캠페인" },
    });
    expect(r.status).toBe("failed");
    if (r.status === "failed") {
      expect(r.reason).toMatch(/예약/);
    }
  });

  it("과거 시각 → failed", async () => {
    const r = await scheduleAction({
      step1: { groupId: VALID_UUID },
      step2: validStep2Sms,
      step3: { title: "캠페인" },
      scheduleAt: "2020-01-01T00:00:00.000Z",
    });
    expect(r.status).toBe("failed");
    if (r.status === "failed") {
      expect(r.reason).toMatch(/이후|과거|현재/);
    }
  });
});

describe("resendFailedAction · dev-seed 차단", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("UUID 캠페인 ID → dev_seed_mode", async () => {
    const r = await resendFailedAction(VALID_UUID);
    expect(r.status).toBe("dev_seed_mode");
  });

  it("빈 ID → failed (입력 가드가 dev-seed 보다 먼저)", async () => {
    const r = await resendFailedAction("");
    expect(r.status).toBe("failed");
    if (r.status === "failed") {
      expect(r.reason).toMatch(/캠페인 ID|유효/);
    }
  });
});
