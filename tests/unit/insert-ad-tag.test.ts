import { describe, it, expect } from "vitest";
import {
  insertAdTag,
  insertAdSubjectTag,
} from "@/lib/messaging/guards/insert-ad-tag";

/**
 * F3-A · (광고) 표기 자동 삽입 가드.
 *
 * 본문 규약:
 *   - isAd=false → 원문 그대로.
 *   - isAd=true 이고 앞에 `(광고)` 또는 `[광고]` 가 이미 있으면 중복 삽입 금지.
 *   - 그 외는 `(광고)\n세정학원\n{본문}` 형식(첫 줄 (광고), 둘째 줄 발신 브랜드명).
 *
 * 제목 규약:
 *   - isAd=true & 제목 있음 → `(광고) {제목}`.
 *   - isAd=false / null / 빈 제목 / 이미 (광고) → 그대로.
 */

describe("insertAdTag · isAd=false", () => {
  it("광고 아님 → 원문 그대로", () => {
    expect(insertAdTag("안녕하세요", false)).toBe("안녕하세요");
  });

  it("광고 아님 · 본문이 이미 (광고) 포함 → 그대로 둠", () => {
    expect(insertAdTag("(광고) 이벤트", false)).toBe("(광고) 이벤트");
  });
});

describe("insertAdTag · isAd=true · 삽입", () => {
  it("일반 본문 → (광고) + 세정학원 머리 붙임", () => {
    expect(insertAdTag("안녕하세요", true)).toBe("(광고)\n세정학원\n안녕하세요");
  });

  it("숫자/영문 본문도 동일하게 머리 붙음", () => {
    expect(insertAdTag("Sale 50%", true)).toBe("(광고)\n세정학원\nSale 50%");
  });
});

describe("insertAdTag · 중복 삽입 방지", () => {
  it("이미 (광고) 로 시작 → 그대로", () => {
    expect(insertAdTag("(광고) 이미있음", true)).toBe("(광고) 이미있음");
  });

  it("이미 [광고] 로 시작 → 그대로", () => {
    expect(insertAdTag("[광고] 이미있음", true)).toBe("[광고] 이미있음");
  });

  it("선행 공백이 있는 (광고) 도 중복으로 판정 → 그대로", () => {
    expect(insertAdTag(" (광고) 앞공백", true)).toBe(" (광고) 앞공백");
  });
});

describe("insertAdTag · 경계값", () => {
  it("본문 중간에 (광고) 가 있으면 머리에 정상 삽입", () => {
    expect(insertAdTag("세정학원 (광고) 공지", true)).toBe(
      "(광고)\n세정학원\n세정학원 (광고) 공지",
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
