import { describe, it, expect } from "vitest";
import { checkQuietHours } from "@/lib/messaging/guards/check-quiet-hours";

/**
 * F3-A · 야간 광고 차단 가드(정통부 고시 21~08).
 *
 * 구현 경계:
 *   - blocked = hour >= 21 || hour < 8
 *   - 08:00 정각 → 허용
 *   - 07:59 → 차단
 *   - 21:00 정각 → 차단
 *   - 20:59 → 허용
 *   - isAd=false → 언제나 허용 (가드 비적용)
 *
 * KST 오프셋 명시한 ISO 문자열로 Date 생성 → 내부에서
 * Intl.DateTimeFormat(timeZone: 'Asia/Seoul') 로 변환되어 안전하게 "시" 추출.
 */

describe("checkQuietHours · isAd=false", () => {
  it("정보성 문자는 언제나 허용", () => {
    // 새벽 3시 (KST) 라도 정보성이면 OK
    const dt = new Date("2026-04-22T03:00:00+09:00");
    expect(checkQuietHours(dt, false)).toEqual({ allowed: true });
  });

  it("정보성은 21:00 정각에도 허용", () => {
    const dt = new Date("2026-04-22T21:00:00+09:00");
    expect(checkQuietHours(dt, false)).toEqual({ allowed: true });
  });
});

describe("checkQuietHours · 경계값", () => {
  it("광고 · 08:00 정각 KST → 허용 (경계 열림)", () => {
    const dt = new Date("2026-04-22T08:00:00+09:00");
    expect(checkQuietHours(dt, true)).toEqual({ allowed: true });
  });

  it("광고 · 07:59 KST → 차단", () => {
    const dt = new Date("2026-04-22T07:59:00+09:00");
    const r = checkQuietHours(dt, true);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("야간");
  });

  it("광고 · 21:00 정각 KST → 차단 (경계 닫힘)", () => {
    const dt = new Date("2026-04-22T21:00:00+09:00");
    const r = checkQuietHours(dt, true);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("야간");
  });

  it("광고 · 20:59 KST → 허용", () => {
    const dt = new Date("2026-04-22T20:59:00+09:00");
    expect(checkQuietHours(dt, true)).toEqual({ allowed: true });
  });
});

describe("checkQuietHours · 일반 시간대", () => {
  it("광고 · 14:00 KST (대낮) → 허용", () => {
    const dt = new Date("2026-04-22T14:00:00+09:00");
    expect(checkQuietHours(dt, true)).toEqual({ allowed: true });
  });

  it("광고 · 00:30 KST (새벽) → 차단", () => {
    const dt = new Date("2026-04-22T00:30:00+09:00");
    const r = checkQuietHours(dt, true);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  it("광고 · 23:30 KST → 차단 · reason 한글 포함", () => {
    const dt = new Date("2026-04-22T23:30:00+09:00");
    const r = checkQuietHours(dt, true);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("21~08");
  });
});

describe("checkQuietHours · 타임존 주입", () => {
  it("UTC 기준 22시(광고)는 UTC TZ 로 검사하면 차단", () => {
    // 2026-04-22T22:00:00Z → UTC hour 22 → 차단
    const dt = new Date("2026-04-22T22:00:00Z");
    const r = checkQuietHours(dt, true, "UTC");
    expect(r.allowed).toBe(false);
  });

  it("UTC 기준 10시(광고) · UTC TZ → 허용", () => {
    const dt = new Date("2026-04-22T10:00:00Z");
    expect(checkQuietHours(dt, true, "UTC")).toEqual({ allowed: true });
  });
});
