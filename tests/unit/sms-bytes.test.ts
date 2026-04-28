import { describe, it, expect } from "vitest";
import {
  countEucKrBytes,
  exceedsLimit,
  byteProgress,
} from "@/lib/messaging/sms-bytes";
import { BYTE_LIMITS } from "@/lib/schemas/template";

/**
 * F3-A · EUC-KR 바이트 계산 유틸 단위 테스트.
 *
 * 규약 (구현 기준):
 *   - ASCII 1바이트, 한글/CJK 2바이트, 기타 BMP 2바이트, 서로게이트(이모지) 4바이트.
 *   - exceedsLimit: 정확히 한도 바이트 = 허용(false), 초과 = true.
 */

describe("countEucKrBytes · 순수 바이트 카운트", () => {
  describe("기본 케이스", () => {
    it("빈 문자열 → 0", () => {
      expect(countEucKrBytes("")).toBe(0);
    });

    it("ASCII 10자 → 10바이트", () => {
      expect(countEucKrBytes("HelloWorld")).toBe(10);
    });

    it('한글 "세정학원" → 8바이트', () => {
      expect(countEucKrBytes("세정학원")).toBe(8);
    });

    it('이모지 "😀" → 4바이트 (서로게이트 페어, 과대평가 OK)', () => {
      expect(countEucKrBytes("😀")).toBe(4);
    });
  });

  describe("혼합 문자열", () => {
    it('"세정 CRM 📱" → 한글 2자(4) + 공백·영문(5) + 이모지(4) = 13바이트', () => {
      // 세(2) 정(2) 공백(1) C(1) R(1) M(1) 공백(1) 📱(4) = 13
      expect(countEucKrBytes("세정 CRM 📱")).toBe(13);
    });

    it("개행·탭(제어문자)은 ASCII 1바이트로 계산", () => {
      expect(countEucKrBytes("a\nb\tc")).toBe(5);
    });

    it("한자(CJK) 1자 → 2바이트", () => {
      expect(countEucKrBytes("漢")).toBe(2);
    });
  });
});

describe("exceedsLimit · 한도 경계", () => {
  describe("SMS 90바이트 경계", () => {
    it('"가".repeat(45) → 정확히 90바이트 → 허용(false)', () => {
      const body = "가".repeat(45);
      expect(countEucKrBytes(body)).toBe(90);
      expect(exceedsLimit(body, "SMS")).toBe(false);
    });

    it('"가".repeat(46) → 92바이트 → 초과(true)', () => {
      const body = "가".repeat(46);
      expect(exceedsLimit(body, "SMS")).toBe(true);
    });

    it("ASCII 90자(90바이트) → 허용", () => {
      expect(exceedsLimit("a".repeat(90), "SMS")).toBe(false);
    });
  });

  describe("LMS 2000바이트 경계", () => {
    it('"가".repeat(1000) → 2000바이트 → 허용', () => {
      expect(exceedsLimit("가".repeat(1000), "LMS")).toBe(false);
    });

    it('"가".repeat(1001) → 2002바이트 → 초과', () => {
      expect(exceedsLimit("가".repeat(1001), "LMS")).toBe(true);
    });
  });

  describe("ALIMTALK 1000바이트 경계", () => {
    it('"가".repeat(500) → 1000바이트 → 허용', () => {
      expect(exceedsLimit("가".repeat(500), "ALIMTALK")).toBe(false);
    });

    it('"가".repeat(501) → 1002바이트 → 초과', () => {
      expect(exceedsLimit("가".repeat(501), "ALIMTALK")).toBe(true);
    });
  });
});

describe("byteProgress · UI 진행바용 계산", () => {
  it("SMS 90바이트 한도 기준 45바이트(한글 22.5자 → 22자=44바이트) 진행률", () => {
    const result = byteProgress("가".repeat(22), "SMS");
    expect(result).toEqual({
      bytes: 44,
      limit: 90,
      ratio: 44 / 90,
    });
  });

  it("빈 본문 → bytes=0, ratio=0", () => {
    const result = byteProgress("", "LMS");
    expect(result).toEqual({ bytes: 0, limit: 2000, ratio: 0 });
  });

  it("한도 초과 시 ratio > 1 허용", () => {
    const result = byteProgress("가".repeat(100), "SMS"); // 200바이트
    expect(result.bytes).toBe(200);
    expect(result.limit).toBe(BYTE_LIMITS.SMS);
    expect(result.ratio).toBeGreaterThan(1);
  });

  it("LMS 한도 · limit 필드 정확", () => {
    const result = byteProgress("hi", "LMS");
    expect(result.limit).toBe(BYTE_LIMITS.LMS);
  });

  it("ALIMTALK 한도 · limit 필드 정확", () => {
    const result = byteProgress("hi", "ALIMTALK");
    expect(result.limit).toBe(BYTE_LIMITS.ALIMTALK);
  });
});
