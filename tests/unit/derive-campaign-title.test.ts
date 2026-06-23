import { describe, it, expect } from "vitest";
import { deriveCampaignTitle } from "@/lib/messaging/derive-campaign-title";

/**
 * 캠페인 제목 자동 생성 — 입력칸 제거 후 본문 앞부분으로 파생(2026-06-23).
 * 스키마(ComposeStep3Schema: 1~60자)를 항상 통과해야 한다(비어있지 않음·≤60자).
 */

describe("deriveCampaignTitle", () => {
  it("본문 첫 줄을 그대로 제목으로", () => {
    expect(deriveCampaignTitle("4월 정기 안내입니다")).toBe("4월 정기 안내입니다");
  });

  it("첫 줄만 사용 (둘째 줄 무시)", () => {
    expect(deriveCampaignTitle("개강 안내\n자세한 내용은...")).toBe("개강 안내");
  });

  it("앞 공백/빈 줄은 건너뛰고 첫 내용 줄", () => {
    expect(deriveCampaignTitle("\n\n  실제 제목\n본문")).toBe("실제 제목");
  });

  it("30자 초과 → 30자 + …", () => {
    const long = "가".repeat(40);
    const out = deriveCampaignTitle(long);
    expect(out).toBe("가".repeat(30) + "…");
    expect(out.length).toBeLessThanOrEqual(60); // 스키마 상한 통과
  });

  it("빈 본문 → '무제 캠페인'", () => {
    expect(deriveCampaignTitle("")).toBe("무제 캠페인");
  });

  it("공백뿐인 본문 → '무제 캠페인'", () => {
    expect(deriveCampaignTitle("   \n  \n")).toBe("무제 캠페인");
  });

  it("결과는 항상 1~60자 (스키마 호환)", () => {
    for (const body of ["", "짧게", "가".repeat(100), "\n\n\n"]) {
      const out = deriveCampaignTitle(body);
      expect(out.trim().length).toBeGreaterThanOrEqual(1);
      expect(out.length).toBeLessThanOrEqual(60);
    }
  });
});
