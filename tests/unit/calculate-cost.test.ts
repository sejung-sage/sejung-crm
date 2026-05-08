import { describe, it, expect } from "vitest";
import { calculateCost } from "@/lib/messaging/calculate-cost";
import { SENDON_UNIT_COST } from "@/lib/messaging/cost-rates";

/**
 * F3 Part B · 발송 비용 계산기.
 *
 * sendon 세정학원 전용 단가 (`SENDON_UNIT_COST`) × 수신자 수.
 *  - SMS  : 7.4원
 *  - LMS  : 24원
 *  - 알림톡: 6.4원
 *
 * 정수만 허용 (수신자 수). 음수 금지. 0 명은 합계 0.
 *
 * 회귀 보호 포인트(과금 직접 영향):
 *   - 단가 고정 검증 (단가 변경 시 본 테스트가 회귀 알람).
 *   - unitCost·totalCost 는 float 가능 — DB INT 저장 시 storage 보낼 때 round.
 *   - 부동소수점 우회 입력(수신자 수 1.5) 은 throw (합계 부정확 방지).
 */

describe("calculateCost · 단가 × 수신자 수", () => {
  it("SMS 100명 → 단가 7.4 · 합계 740", () => {
    const r = calculateCost("SMS", 100);
    expect(r).toEqual({
      type: "SMS",
      unitCost: 7.4,
      recipientCount: 100,
      totalCost: 740,
    });
  });

  it("LMS 50명 → 단가 24 · 합계 1200", () => {
    const r = calculateCost("LMS", 50);
    expect(r).toEqual({
      type: "LMS",
      unitCost: 24,
      recipientCount: 50,
      totalCost: 1200,
    });
  });

  it("ALIMTALK 200명 → 단가 6.4 · 합계 1280", () => {
    const r = calculateCost("ALIMTALK", 200);
    expect(r).toEqual({
      type: "ALIMTALK",
      unitCost: 6.4,
      recipientCount: 200,
      totalCost: 1280,
    });
  });

  it("단가 상수가 SENDON_UNIT_COST 와 일치 (회귀 보호)", () => {
    expect(calculateCost("SMS", 1).unitCost).toBe(SENDON_UNIT_COST.SMS);
    expect(calculateCost("LMS", 1).unitCost).toBe(SENDON_UNIT_COST.LMS);
    expect(calculateCost("ALIMTALK", 1).unitCost).toBe(
      SENDON_UNIT_COST.ALIMTALK,
    );
  });
});

describe("calculateCost · 경계값", () => {
  it("수신자 0명 → 합계 0 (단가는 그대로 유지)", () => {
    const r = calculateCost("SMS", 0);
    expect(r.totalCost).toBe(0);
    expect(r.recipientCount).toBe(0);
    expect(r.unitCost).toBe(7.4);
  });

  it("수신자 1명(SMS) → totalCost 7.4 (소수)", () => {
    const r = calculateCost("SMS", 1);
    expect(r.totalCost).toBe(7.4);
  });

  it("수신자 1명(LMS) → 단가 그대로", () => {
    const r = calculateCost("LMS", 1);
    expect(r.totalCost).toBe(24);
  });

  it("수신자 10000명(상한) → 합계 산식 정확 · 오버플로 없음", () => {
    const r = calculateCost("LMS", 10_000);
    expect(r.totalCost).toBe(240_000);
  });

  it("SMS 7명 → totalCost 51.8 (float 누적은 호출자가 round)", () => {
    const r = calculateCost("SMS", 7);
    // 7 × 7.4 = 51.8
    expect(r.totalCost).toBeCloseTo(51.8, 5);
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
