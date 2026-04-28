import { describe, it, expect } from "vitest";
import { insertAdTag } from "@/lib/messaging/guards/insert-ad-tag";

/**
 * F3-A · (광고) prefix 자동 삽입 가드.
 *
 * 구현 규약:
 *   - isAd=false → 원문 그대로.
 *   - isAd=true 이고 앞에 `(광고)` 또는 `[광고]` 가 이미 있으면 중복 삽입 금지.
 *     선행 공백 허용(`\s*` 를 정규식으로 매칭).
 *   - 그 외는 `(광고) ` prefix 붙임.
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
  it("일반 본문 → (광고) 프리픽스 붙임", () => {
    expect(insertAdTag("안녕하세요", true)).toBe("(광고) 안녕하세요");
  });

  it("숫자/영문 본문도 동일하게 prefix 붙음", () => {
    expect(insertAdTag("Sale 50%", true)).toBe("(광고) Sale 50%");
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

  it("선행 공백 다수 + [광고] 도 중복으로 판정", () => {
    expect(insertAdTag("   [광고] 다중공백", true)).toBe("   [광고] 다중공백");
  });
});

describe("insertAdTag · 경계값", () => {
  it("빈 문자열 + isAd=true → '(광고) ' 만 붙음 (현행 구현 정책)", () => {
    // 현행 구현은 본문 검증 없이 무조건 "(광고) {body}" 형식.
    expect(insertAdTag("", true)).toBe("(광고) ");
  });

  it("공백만 있는 문자열 + isAd=true → (광고) prefix 붙음 (AD_PREFIX 아님)", () => {
    expect(insertAdTag("   ", true)).toBe("(광고)    ");
  });

  it("본문 중간에 (광고) 가 있으면 prefix 없음 아님 → 무조건 앞에 붙음", () => {
    expect(insertAdTag("세정학원 (광고) 공지", true)).toBe(
      "(광고) 세정학원 (광고) 공지",
    );
  });
});
