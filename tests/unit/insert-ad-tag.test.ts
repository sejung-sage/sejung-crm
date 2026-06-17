import { describe, it, expect } from "vitest";
import {
  insertSenderHeader,
  insertAdSubjectTag,
  branchBrandName,
  BRAND_BASE,
} from "@/lib/messaging/guards/insert-ad-tag";

/**
 * F3-A · 발신 브랜드 머리말 + (광고) 표기 자동 삽입 가드.
 *
 * 본문 규약(insertSenderHeader · 2026-06-17 개편):
 *   - 광고/비광고 무관, 본문 맨 위에 발신 브랜드명을 한 줄 항상 붙인다.
 *   - 광고면 그 위에 `(광고)` 줄을 한 번 더 얹는다.
 *   - 비광고: `{브랜드}\n{본문}` · 광고: `(광고)\n{브랜드}\n{본문}`.
 *   - 이미 (광고)/[광고] 로 시작하거나 첫 줄이 이미 그 브랜드면 중복 삽입 금지.
 *
 * 제목 규약: isAd=true & 제목 있음 → `(광고) {제목}` (브랜드는 제목엔 안 붙임).
 */

describe("branchBrandName · 분원별 발신 브랜드명", () => {
  it("대치 / 미지정 / 알 수 없는 분원 → 기본 '세정학원'", () => {
    expect(branchBrandName("대치")).toBe("세정학원");
    expect(branchBrandName(undefined)).toBe("세정학원");
    expect(branchBrandName(null)).toBe("세정학원");
    expect(branchBrandName("마스터")).toBe("세정학원");
    expect(BRAND_BASE).toBe("세정학원");
  });

  it("그 외 분원 → '{분원} 세정학원'", () => {
    expect(branchBrandName("반포")).toBe("반포 세정학원");
    expect(branchBrandName("송도")).toBe("송도 세정학원");
    expect(branchBrandName("방배")).toBe("방배 세정학원");
  });
});

describe("insertSenderHeader · 비광고(isAd=false)", () => {
  it("브랜드 머리를 맨 위에 붙임 (광고 표기 없음)", () => {
    expect(insertSenderHeader("안녕하세요", false, "세정학원")).toBe(
      "세정학원\n안녕하세요",
    );
  });

  it("분원 브랜드명 반영 (반포)", () => {
    expect(insertSenderHeader("안녕하세요", false, "반포 세정학원")).toBe(
      "반포 세정학원\n안녕하세요",
    );
  });

  it("첫 줄이 이미 그 브랜드면 중복 안 붙임", () => {
    expect(insertSenderHeader("세정학원\n본문", false, "세정학원")).toBe(
      "세정학원\n본문",
    );
  });
});

describe("insertSenderHeader · 광고(isAd=true)", () => {
  it("(광고) + 브랜드 머리 붙임", () => {
    expect(insertSenderHeader("안녕하세요", true, "세정학원")).toBe(
      "(광고)\n세정학원\n안녕하세요",
    );
  });

  it("분원 브랜드명 반영 (반포)", () => {
    expect(insertSenderHeader("Sale 50%", true, "반포 세정학원")).toBe(
      "(광고)\n반포 세정학원\nSale 50%",
    );
  });
});

describe("insertSenderHeader · 중복 삽입 방지", () => {
  it("이미 (광고) 로 시작 → 그대로", () => {
    expect(insertSenderHeader("(광고) 이미있음", true, "세정학원")).toBe(
      "(광고) 이미있음",
    );
  });

  it("이미 [광고] 로 시작 → 그대로", () => {
    expect(insertSenderHeader("[광고] 이미있음", true, "세정학원")).toBe(
      "[광고] 이미있음",
    );
  });

  it("선행 공백이 있는 (광고) 도 중복으로 판정 → 그대로", () => {
    expect(insertSenderHeader(" (광고) 앞공백", true, "세정학원")).toBe(
      " (광고) 앞공백",
    );
  });
});

describe("insertAdSubjectTag", () => {
  it("광고 아님 → 그대로", () => {
    expect(insertAdSubjectTag("설명회 안내", false)).toBe("설명회 안내");
  });

  it("광고 + 제목 → (광고) prefix", () => {
    expect(insertAdSubjectTag("설명회 안내", true)).toBe("(광고) 설명회 안내");
  });

  it("null / 빈 제목 → 그대로(붙이지 않음)", () => {
    expect(insertAdSubjectTag(null, true)).toBeNull();
    expect(insertAdSubjectTag("", true)).toBe("");
    expect(insertAdSubjectTag("   ", true)).toBe("   ");
  });

  it("이미 (광고) 로 시작 → 중복 삽입 안 함", () => {
    expect(insertAdSubjectTag("(광고) 설명회", true)).toBe("(광고) 설명회");
  });
});
