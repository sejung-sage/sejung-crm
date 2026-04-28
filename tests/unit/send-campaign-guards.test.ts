import { describe, it, expect, beforeEach } from "vitest";
import { sendCampaign } from "@/lib/messaging/send-campaign";
import { testSend } from "@/lib/messaging/test-send";
import { resendFailedMessages } from "@/lib/messaging/resend-failed";

/**
 * F3 Part B · 발송 함수 dev-seed 가드.
 *
 * 모든 실제 발송 경로(`sendCampaign` / `testSend` / `resendFailedMessages`)는
 * dev-seed 모드에서 DB 접근/벤더 호출 없이 즉시 `dev_seed_mode` 반환해야 한다.
 *
 * 회귀 보호: 개발 환경에서 실수로 실 SMS 가 나가는 것을 차단(CLAUDE.md 마지막 줄).
 */

const VALID_UUID = "11111111-1111-4111-8111-111111111111";

describe("sendCampaign · dev-seed 차단", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("정상 입력이어도 dev-seed 면 dev_seed_mode 즉시 반환", async () => {
    const r = await sendCampaign({
      title: "테스트 캠페인",
      groupId: VALID_UUID,
      templateId: null,
      body: "안녕하세요",
      subject: null,
      type: "SMS",
      isAd: false,
      scheduledAt: null,
      isTest: false,
    });
    expect(r.status).toBe("dev_seed_mode");
    if (r.status === "dev_seed_mode") {
      expect(r.reason).toMatch(/시드|dev|차단/i);
    }
  });

  it("예약 발송 입력도 dev_seed_mode (차단 우선)", async () => {
    const r = await sendCampaign({
      title: "예약",
      groupId: VALID_UUID,
      templateId: null,
      body: "본문",
      subject: null,
      type: "SMS",
      isAd: false,
      scheduledAt: new Date("2027-01-01T00:00:00Z"),
      isTest: false,
    });
    expect(r.status).toBe("dev_seed_mode");
  });

  it("광고성 + 야간 시각이어도 dev_seed_mode (가드보다 시드 차단이 먼저)", async () => {
    const r = await sendCampaign({
      title: "야간 광고",
      groupId: VALID_UUID,
      templateId: null,
      body: "광고",
      subject: null,
      type: "SMS",
      isAd: true,
      scheduledAt: new Date("2026-04-22T22:00:00+09:00"),
      isTest: false,
    });
    expect(r.status).toBe("dev_seed_mode");
  });
});

describe("testSend · dev-seed 차단", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("정상 입력이어도 dev_seed_mode 반환", async () => {
    const r = await testSend({
      body: "테스트",
      subject: null,
      type: "SMS",
      isAd: false,
      toPhone: "01012345678",
    });
    expect(r.status).toBe("dev_seed_mode");
  });

  it("LMS + subject 정상 입력이어도 dev_seed_mode", async () => {
    const r = await testSend({
      body: "긴 본문",
      subject: "제목",
      type: "LMS",
      isAd: false,
      toPhone: "01098765432",
    });
    expect(r.status).toBe("dev_seed_mode");
  });

  it("광고성 + 야간 KST 도 dev_seed_mode (시드 차단 우선)", async () => {
    const r = await testSend({
      body: "광고 테스트",
      subject: null,
      type: "SMS",
      isAd: true,
      toPhone: "01012345678",
    });
    expect(r.status).toBe("dev_seed_mode");
  });
});

describe("resendFailedMessages · dev-seed 차단", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("아무 캠페인 ID 도 dev_seed_mode 반환", async () => {
    const r = await resendFailedMessages("any-campaign-id");
    expect(r.status).toBe("dev_seed_mode");
  });

  it("UUID 형식이어도 dev_seed_mode", async () => {
    const r = await resendFailedMessages(VALID_UUID);
    expect(r.status).toBe("dev_seed_mode");
  });

  it("빈 문자열이어도 dev_seed_mode (시드 차단이 ID 검증보다 먼저)", async () => {
    const r = await resendFailedMessages("");
    expect(r.status).toBe("dev_seed_mode");
  });
});
