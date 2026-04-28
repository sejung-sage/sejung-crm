import { describe, it, expect } from "vitest";
import { calculateCost } from "@/lib/messaging/calculate-cost";
import { SOLAPI_UNIT_COST } from "@/lib/messaging/cost-rates";

/**
 * F3 Part B · 발송 비용 계산기.
 *
 * 솔라피 단가 (`SOLAPI_UNIT_COST`) × 수신자 수.
 * 정수만 허용. 음수 금지. 0 명은 합계 0.
 *
 * 회귀 보호 포인트(과금 직접 영향):
 *   - SMS 8 / LMS 14 / ALIMTALK 13 단가 고정.
 *   - 부동소수점 우회 입력은 throw (합계 부정확 방지).
 */

describe("calculateCost · 단가 × 수신자 수", () => {
  it("SMS 100명 → 단가 8 · 합계 800", () => {
    const r = calculateCost("SMS", 100);
    expect(r).toEqual({
      type: "SMS",
      unitCost: 8,
      recipientCount: 100,
      totalCost: 800,
    });
  });

  it("LMS 50명 → 단가 14 · 합계 700", () => {
    const r = calculateCost("LMS", 50);
    expect(r).toEqual({
      type: "LMS",
      unitCost: 14,
      recipientCount: 50,
      totalCost: 700,
    });
  });

  it("ALIMTALK 200명 → 단가 13 · 합계 2600", () => {
    const r = calculateCost("ALIMTALK", 200);
    expect(r).toEqual({
      type: "ALIMTALK",
      unitCost: 13,
      recipientCount: 200,
      totalCost: 2600,
    });
  });

  it("단가 상수가 SOLAPI_UNIT_COST 와 일치 (회귀 보호)", () => {
    expect(calculateCost("SMS", 1).unitCost).toBe(SOLAPI_UNIT_COST.SMS);
    expect(calculateCost("LMS", 1).unitCost).toBe(SOLAPI_UNIT_COST.LMS);
    expect(calculateCost("ALIMTALK", 1).unitCost).toBe(
      SOLAPI_UNIT_COST.ALIMTALK,
    );
  });
});

describe("calculateCost · 경계값", () => {
  it("수신자 0명 → 합계 0 (단가는 그대로 유지)", () => {
    const r = calculateCost("SMS", 0);
    expect(r.totalCost).toBe(0);
    expect(r.recipientCount).toBe(0);
    expect(r.unitCost).toBe(8);
  });

  it("수신자 1명 → 단가 그대로 (LMS)", () => {
    const r = calculateCost("LMS", 1);
    expect(r.totalCost).toBe(14);
  });

  it("수신자 10000명(상한) → 합계 산식 정확 · 오버플로 없음", () => {
    const r = calculateCost("LMS", 10_000);
    expect(r.totalCost).toBe(140_000);
  });
});

describe("calculateCost · 잘못된 입력은 throw (한글 메시지)", () => {
  it("음수 수신자(-1) → throw", () => {
    expect(() => calculateCost("SMS", -1)).toThrow();
    try {
      calculateCost("SMS", -1);
    } catch (e) {
      expect((e as Error).message).toMatch(/0\s*이상/);
    }
  });

  it("정수 아님(1.5) → throw", () => {
    expect(() => calculateCost("SMS", 1.5)).toThrow();
    try {
      calculateCost("SMS", 1.5);
    } catch (e) {
      expect((e as Error).message).toMatch(/정수/);
    }
  });

  it("정수 아님(0.1) → throw", () => {
    expect(() => calculateCost("ALIMTALK", 0.1)).toThrow();
  });
});
