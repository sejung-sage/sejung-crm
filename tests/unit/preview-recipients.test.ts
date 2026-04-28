import { describe, it, expect, beforeEach } from "vitest";
import { previewRecipients } from "@/lib/messaging/preview-recipients";

/**
 * F3 Part B · 미리보기 산출.
 *
 * dev-seed 모드에서 동작:
 *   - dev-group-1: 대치 + 고2 → DC0001·DC0002 2명 (탈퇴 제외 후)
 *   - 광고/정보성에 따라 본문 prefix·footer 변환
 *   - 야간(21~08 KST) + 광고 → blockedByQuietHours=true
 *
 * 회귀 보호: 야간 광고 차단·수신거부 적용·비용 산식.
 */

describe("previewRecipients · dev-seed · 정보성(낮 시간)", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("dev-group-1 + isAd=false + SMS · 낮 시간 → 정상 미리보기", async () => {
    const r = await previewRecipients({
      groupId: "dev-group-1",
      body: "안녕하세요 세정학원입니다",
      isAd: false,
      type: "SMS",
      scheduledAt: new Date("2026-04-22T14:00:00+09:00"),
    });

    // dev-group-1: 대치 + 고2 → DC0001·DC0002 (재원생 2명)
    expect(r.recipientCount).toBe(2);
    // SMS 단가 8 × 2 = 16
    expect(r.cost.totalCost).toBe(16);
    expect(r.cost.unitCost).toBe(8);
    expect(r.cost.type).toBe("SMS");
    // 정보성: 본문 그대로
    expect(r.finalBody).toBe("안녕하세요 세정학원입니다");
    expect(r.blockedByQuietHours).toBe(false);
    expect(r.blockReason).toBeUndefined();
    expect(r.sampleRecipients.length).toBeLessThanOrEqual(5);
    expect(r.sampleRecipients.length).toBe(2);
  });

  it("LMS 정보성 → 단가 14 적용", async () => {
    const r = await previewRecipients({
      groupId: "dev-group-1",
      body: "긴 본문 안내",
      isAd: false,
      type: "LMS",
      scheduledAt: new Date("2026-04-22T14:00:00+09:00"),
    });
    expect(r.cost.unitCost).toBe(14);
    expect(r.cost.totalCost).toBe(28);
  });

  it("ALIMTALK 정보성 → 단가 13 적용", async () => {
    const r = await previewRecipients({
      groupId: "dev-group-1",
      body: "알림톡 안내",
      isAd: false,
      type: "ALIMTALK",
      scheduledAt: new Date("2026-04-22T14:00:00+09:00"),
    });
    expect(r.cost.unitCost).toBe(13);
    expect(r.cost.totalCost).toBe(26);
  });

  it("sampleRecipients 각 항목에 name·phone 존재", async () => {
    const r = await previewRecipients({
      groupId: "dev-group-1",
      body: "본문",
      isAd: false,
      type: "SMS",
      scheduledAt: new Date("2026-04-22T14:00:00+09:00"),
    });
    for (const s of r.sampleRecipients) {
      expect(typeof s.name).toBe("string");
      expect(typeof s.phone).toBe("string");
      expect(s.phone.length).toBeGreaterThan(0);
    }
  });
});

describe("previewRecipients · dev-seed · 광고성(낮 시간)", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("isAd=true · 낮 시간 → finalBody 에 (광고) prefix + 무료수신거부 footer", async () => {
    const r = await previewRecipients({
      groupId: "dev-group-1",
      body: "여름 특강 모집",
      isAd: true,
      type: "SMS",
      scheduledAt: new Date("2026-04-22T14:00:00+09:00"),
    });

    // (광고) 또는 [광고] prefix
    expect(r.finalBody).toMatch(/^[\s]*[[(]광고[\])]/);
    expect(r.finalBody).toContain("여름 특강 모집");
    expect(r.finalBody).toContain("무료수신거부");
    expect(r.blockedByQuietHours).toBe(false);
    expect(r.recipientCount).toBe(2);
  });
});

describe("previewRecipients · dev-seed · 광고성 + 야간 차단", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("22:00 KST + isAd=true → blockedByQuietHours=true · blockReason 한글", async () => {
    const r = await previewRecipients({
      groupId: "dev-group-1",
      body: "야간 광고 시도",
      isAd: true,
      type: "SMS",
      scheduledAt: new Date("2026-04-22T22:00:00+09:00"),
    });
    expect(r.blockedByQuietHours).toBe(true);
    expect(r.blockReason).toBeTruthy();
    expect(r.blockReason).toMatch(/야간/);
  });

  it("07:59 KST + 광고 → blockedByQuietHours=true (08:00 정각 전까지 차단)", async () => {
    const r = await previewRecipients({
      groupId: "dev-group-1",
      body: "새벽 광고",
      isAd: true,
      type: "SMS",
      scheduledAt: new Date("2026-04-22T07:59:00+09:00"),
    });
    expect(r.blockedByQuietHours).toBe(true);
  });

  it("야간이라도 정보성(isAd=false) 은 차단 없음", async () => {
    const r = await previewRecipients({
      groupId: "dev-group-1",
      body: "야간 정보성",
      isAd: false,
      type: "SMS",
      scheduledAt: new Date("2026-04-22T23:30:00+09:00"),
    });
    expect(r.blockedByQuietHours).toBe(false);
  });
});

describe("previewRecipients · dev-seed · 존재하지 않는 그룹", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("미존재 groupId → throw (한글 메시지)", async () => {
    await expect(
      previewRecipients({
        groupId: "dev-group-does-not-exist",
        body: "본문",
        isAd: false,
        type: "SMS",
        scheduledAt: new Date("2026-04-22T14:00:00+09:00"),
      }),
    ).rejects.toThrow(/존재하지 않는 그룹/);
  });
});

describe("previewRecipients · dev-seed · 수신자 0명", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("dev-group-3(송도 고3 탐구 — 시드에 0건) → recipientCount=0 · cost.totalCost=0", async () => {
    const r = await previewRecipients({
      groupId: "dev-group-3",
      body: "본문",
      isAd: false,
      type: "SMS",
      scheduledAt: new Date("2026-04-22T14:00:00+09:00"),
    });
    expect(r.recipientCount).toBe(0);
    expect(r.cost.totalCost).toBe(0);
    expect(r.sampleRecipients).toEqual([]);
  });
});
