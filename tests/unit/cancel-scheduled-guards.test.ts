import { describe, it, expect, beforeEach } from "vitest";
import { cancelScheduledCampaignAction } from "@/app/(features)/campaigns/actions";

/**
 * 예약 발송 취소 액션 가드.
 *
 * - 빈 캠페인 ID → failed.
 * - dev-seed 모드 → lib 함수가 DB 도달 전 dev_seed_mode 반환.
 */

describe("cancelScheduledCampaignAction", () => {
  beforeEach(() => {
    delete process.env.SEJUNG_DEV_SEED;
  });

  it("빈 캠페인 ID → failed", async () => {
    const r = await cancelScheduledCampaignAction("");
    expect(r.status).toBe("failed");
    if (r.status === "failed") {
      expect(r.reason).toContain("캠페인 ID");
    }
  });

  it("dev-seed 모드 → dev_seed_mode 조기 반환", async () => {
    process.env.SEJUNG_DEV_SEED = "1";
    const r = await cancelScheduledCampaignAction(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(r.status).toBe("dev_seed_mode");
  });
});
