import { describe, it, expect } from "vitest";
import {
  canTransition,
  CAMPAIGN_STATUS_TRANSITIONS,
} from "@/lib/messaging/campaign-status";
import type { CampaignStatus } from "@/types/database";

/**
 * F3 Part B · 캠페인 상태 머신.
 *
 * 라이프사이클:
 *   임시저장 → 예약됨 / 발송중 / 취소
 *   예약됨   → 발송중 / 취소
 *   발송중   → 완료 / 실패
 *   완료/실패/취소 = 종착(out 없음)
 *
 * 회귀 보호: 잘못된 전이가 허용되면 통계 / 청구가 깨질 수 있다.
 */

const ALL_STATUSES: CampaignStatus[] = [
  "임시저장",
  "예약됨",
  "발송중",
  "완료",
  "실패",
  "취소",
];

describe("canTransition · 정상 전이", () => {
  it("임시저장 → 예약됨", () => {
    expect(canTransition("임시저장", "예약됨")).toBe(true);
  });

  it("임시저장 → 발송중", () => {
    expect(canTransition("임시저장", "발송중")).toBe(true);
  });

  it("임시저장 → 취소", () => {
    expect(canTransition("임시저장", "취소")).toBe(true);
  });

  it("예약됨 → 발송중", () => {
    expect(canTransition("예약됨", "발송중")).toBe(true);
  });

  it("예약됨 → 취소", () => {
    expect(canTransition("예약됨", "취소")).toBe(true);
  });

  it("발송중 → 완료", () => {
    expect(canTransition("발송중", "완료")).toBe(true);
  });

  it("발송중 → 실패", () => {
    expect(canTransition("발송중", "실패")).toBe(true);
  });
});

describe("canTransition · 차단되는 전이", () => {
  it("예약됨 → 완료 (직접 완료 불가, 발송중 거쳐야 함)", () => {
    expect(canTransition("예약됨", "완료")).toBe(false);
  });

  it("예약됨 → 실패 (발송중 거쳐야 함)", () => {
    expect(canTransition("예약됨", "실패")).toBe(false);
  });

  it("완료 → 발송중 (단방향, 종착 상태)", () => {
    expect(canTransition("완료", "발송중")).toBe(false);
  });

  it("완료 → 임시저장", () => {
    expect(canTransition("완료", "임시저장")).toBe(false);
  });

  it("실패 → 발송중", () => {
    expect(canTransition("실패", "발송중")).toBe(false);
  });

  it("취소 → 임시저장 (단방향, 종착 상태)", () => {
    expect(canTransition("취소", "임시저장")).toBe(false);
  });

  it("취소 → 예약됨", () => {
    expect(canTransition("취소", "예약됨")).toBe(false);
  });

  it("임시저장 → 완료 (발송중 우회 금지)", () => {
    expect(canTransition("임시저장", "완료")).toBe(false);
  });

  it("발송중 → 예약됨 (역행 금지)", () => {
    expect(canTransition("발송중", "예약됨")).toBe(false);
  });

  it("발송중 → 임시저장 (역행 금지)", () => {
    expect(canTransition("발송중", "임시저장")).toBe(false);
  });

  it("발송중 → 취소 (실행 중 취소는 별도 로직 — 머신상 금지)", () => {
    expect(canTransition("발송중", "취소")).toBe(false);
  });
});

describe("canTransition · 자기 자신으로의 전이는 모두 false", () => {
  for (const s of ALL_STATUSES) {
    it(`${s} → ${s} 는 false`, () => {
      expect(canTransition(s, s)).toBe(false);
    });
  }
});

describe("CAMPAIGN_STATUS_TRANSITIONS · 종착 상태는 빈 배열", () => {
  it("완료/실패/취소 의 next 는 []", () => {
    expect(CAMPAIGN_STATUS_TRANSITIONS["완료"]).toEqual([]);
    expect(CAMPAIGN_STATUS_TRANSITIONS["실패"]).toEqual([]);
    expect(CAMPAIGN_STATUS_TRANSITIONS["취소"]).toEqual([]);
  });

  it("모든 상태가 맵에 정의되어 있어야 함 (회귀)", () => {
    for (const s of ALL_STATUSES) {
      expect(Array.isArray(CAMPAIGN_STATUS_TRANSITIONS[s])).toBe(true);
    }
  });
});
