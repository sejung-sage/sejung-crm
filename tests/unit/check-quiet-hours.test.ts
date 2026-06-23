import { describe, it, expect } from "vitest";
import { checkQuietHours } from "@/lib/messaging/guards/check-quiet-hours";

/**
 * F3-A · 야간 발송 차단 가드 (비활성).
 *
 * 운영 결정으로 시간대 발송 차단을 전면 해제 → 시각·광고 여부와 무관하게
 * 항상 `{ allowed: true }`.
 */

describe("checkQuietHours · 시간대 차단 해제", () => {
  it("정보성 · 새벽 3시 → 허용", () => {
    const dt = new Date("2026-04-22T03:00:00+09:00");
    expect(checkQuietHours(dt, false)).toEqual({ allowed: true });
  });

  it("광고 · 07:59 KST → 허용 (더 이상 차단 안 함)", () => {
    const dt = new Date("2026-04-22T07:59:00+09:00");
    expect(checkQuietHours(dt, true)).toEqual({ allowed: true });
  });

  it("광고 · 21:00 정각 KST → 허용", () => {
    const dt = new Date("2026-04-22T21:00:00+09:00");
    expect(checkQuietHours(dt, true)).toEqual({ allowed: true });
  });

  it("광고 · 00:30 KST (새벽) → 허용", () => {
    const dt = new Date("2026-04-22T00:30:00+09:00");
    expect(checkQuietHours(dt, true)).toEqual({ allowed: true });
  });

  it("광고 · 23:30 KST → 허용", () => {
    const dt = new Date("2026-04-22T23:30:00+09:00");
    expect(checkQuietHours(dt, true)).toEqual({ allowed: true });
  });

  it("UTC 기준 22시(광고) · UTC TZ → 허용", () => {
    const dt = new Date("2026-04-22T22:00:00Z");
    expect(checkQuietHours(dt, true, "UTC")).toEqual({ allowed: true });
  });
});
