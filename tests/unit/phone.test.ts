import { describe, it, expect } from "vitest";
import { formatPhone, maskPhone, normalizePhone } from "@/lib/phone";

describe("phone utils", () => {
  describe("formatPhone", () => {
    it("11자리 휴대폰을 010-XXXX-XXXX 로 포맷", () => {
      expect(formatPhone("01012345678")).toBe("010-1234-5678");
    });

    it("이미 하이픈 포함이면 그대로 재포맷", () => {
      expect(formatPhone("010-1234-5678")).toBe("010-1234-5678");
    });

    it("서울 지역번호 10자리", () => {
      expect(formatPhone("0212345678")).toBe("02-1234-5678");
    });

    it("빈 값이면 빈 문자열", () => {
      expect(formatPhone(null)).toBe("");
      expect(formatPhone(undefined)).toBe("");
      expect(formatPhone("")).toBe("");
    });
  });

  describe("maskPhone · 로그용 (PRD 6.3)", () => {
    it("010-****-1234 형태로 마스킹", () => {
      expect(maskPhone("01012345678")).toBe("010-****-5678");
    });

    it("하이픈 포함도 같은 결과", () => {
      expect(maskPhone("010-1234-5678")).toBe("010-****-5678");
    });

    it("빈 값이면 빈 문자열", () => {
      expect(maskPhone(null)).toBe("");
    });

    it("번호가 짧으면 *** 로 축약", () => {
      expect(maskPhone("12")).toBe("***");
    });

    it("4자리 이상이면 마지막 4자리만 노출", () => {
      expect(maskPhone("99998888")).toBe("***-****-8888");
    });
  });

  describe("normalizePhone", () => {
    it("하이픈 제거한 숫자만 반환", () => {
      expect(normalizePhone("010-1234-5678")).toBe("01012345678");
    });

    it("null/빈 → null", () => {
      expect(normalizePhone(null)).toBe(null);
      expect(normalizePhone("")).toBe(null);
    });
  });
});
