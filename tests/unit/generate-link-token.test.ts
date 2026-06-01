import { describe, it, expect } from "vitest";
import {
  SEMINAR_LINK_TOKEN_LENGTH,
  generateLinkToken,
} from "@/lib/seminars/generate-link-token";

/**
 * F5 · 학부모 공개 링크 토큰 생성기 단위 테스트.
 *
 * `crm_seminars.link_token` 컬럼에 INSERT 될 값의 정합성 — 길이/문자셋/충돌 — 을
 * 검증한다. UNIQUE 제약(0080)이 최후 가드이지만, 토큰 자체의 정책이 깨지면
 * URL 가드를 우회한 추측 공격 가능성이 커진다.
 */

describe("generateLinkToken · 정책 상수", () => {
  it("SEMINAR_LINK_TOKEN_LENGTH 는 12 (0080 마이그 정책과 동기화)", () => {
    expect(SEMINAR_LINK_TOKEN_LENGTH).toBe(12);
  });
});

describe("generateLinkToken · 단건 호출", () => {
  it("길이가 SEMINAR_LINK_TOKEN_LENGTH(12) 자", () => {
    const token = generateLinkToken();
    expect(token).toHaveLength(SEMINAR_LINK_TOKEN_LENGTH);
  });

  it("URL-safe 문자만(`[A-Za-z0-9_-]`) 포함", () => {
    const token = generateLinkToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });

  it("문자열 타입을 반환한다 (null/undefined 가 절대 새지 않는다)", () => {
    const token = generateLinkToken();
    expect(typeof token).toBe("string");
  });
});

describe("generateLinkToken · 다건 호출 (충돌·엔트로피)", () => {
  it("100회 호출 시 모두 unique (Set size === 100)", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) {
      tokens.add(generateLinkToken());
    }
    expect(tokens.size).toBe(100);
  });

  it("100회 호출 모두 정책(길이 12 + URL-safe) 만족", () => {
    const pattern = /^[A-Za-z0-9_-]{12}$/;
    for (let i = 0; i < 100; i++) {
      expect(generateLinkToken()).toMatch(pattern);
    }
  });
});
