import { describe, it, expect } from "vitest";
import {
  emptyToNull,
  normalizeAmount,
  normalizeDate,
  normalizeGrade,
  normalizeKoreanPhone,
} from "@/lib/schemas/import";

/**
 * F1-03 · Import 전처리 헬퍼 유틸 테스트.
 * DB 표준형(하이픈 없는 11자리)으로 정규화되는지,
 * 잘못된 입력을 엄격하게 null 로 반환하는지 검증.
 */

describe("import helpers · normalizeKoreanPhone", () => {
  describe("정상 케이스", () => {
    it("하이픈 포함 11자리 → 하이픈 제거", () => {
      expect(normalizeKoreanPhone("010-1234-5678")).toBe("01012345678");
    });

    it("공백 포함 → 공백 제거", () => {
      expect(normalizeKoreanPhone("010 1234 5678")).toBe("01012345678");
    });

    it("괄호/하이픈 혼합 → 숫자만 추출", () => {
      expect(normalizeKoreanPhone("(010)1234-5678")).toBe("01012345678");
    });

    it("10자리 번호 허용 (구형 011 등)", () => {
      expect(normalizeKoreanPhone("0111234567")).toBe("0111234567");
    });

    it("숫자 입력 (0 선행 소실) → 10자리 접두사 미일치로 null", () => {
      // JS number 는 leading zero 를 유지할 수 없어 1012345678 은 "1012345678" 이 되고
      // 01[016789] 접두사를 만족하지 못하므로 null. 함수의 접두사 엄격 검증을 증명.
      expect(normalizeKoreanPhone(1012345678)).toBeNull();
    });
  });

  describe("잘못된 접두사", () => {
    it("02X 접두사는 null (01X 만 허용)", () => {
      expect(normalizeKoreanPhone("01212345678")).toBeNull();
    });

    it("012 접두사 null", () => {
      expect(normalizeKoreanPhone("0121234567")).toBeNull();
    });
  });

  describe("길이 경계값", () => {
    it("9자리 이하 거부", () => {
      expect(normalizeKoreanPhone("123")).toBeNull();
      expect(normalizeKoreanPhone("010123456")).toBeNull();
    });

    it("12자리 초과 거부", () => {
      expect(normalizeKoreanPhone("010123456789")).toBeNull();
    });
  });

  describe("비문자열/빈값", () => {
    it("빈 문자열 → null", () => {
      expect(normalizeKoreanPhone("")).toBeNull();
    });

    it("문자 섞임 → 길이 미달로 null", () => {
      expect(normalizeKoreanPhone("abc")).toBeNull();
    });

    it("null / undefined → null", () => {
      expect(normalizeKoreanPhone(null)).toBeNull();
      expect(normalizeKoreanPhone(undefined)).toBeNull();
    });

    it("객체/불리언 → null", () => {
      expect(normalizeKoreanPhone({})).toBeNull();
      expect(normalizeKoreanPhone(true)).toBeNull();
    });
  });
});

describe("import helpers · normalizeGrade", () => {
  // 0012 마이그레이션 정규화 모델: (rawGrade, school) → Grade enum 9종.
  // 결과는 항상 enum 중 하나, null 반환 안 함 (DB CHECK 통과 보장).
  // DB 의 normalize_student_grade(grade_raw, school) 와 동일 룰.

  it("이미 정규화된 enum 값은 그대로 통과", () => {
    expect(normalizeGrade("중1", null)).toBe("중1");
    expect(normalizeGrade("고3", null)).toBe("고3");
    expect(normalizeGrade("재수", "휘문고")).toBe("재수");
    expect(normalizeGrade("졸업", null)).toBe("졸업");
    expect(normalizeGrade("미정", null)).toBe("미정");
  });

  it('정수 "1"/"2"/"3" + 학교 "○○중" → 중1/중2/중3', () => {
    expect(normalizeGrade("1", "대왕중")).toBe("중1");
    expect(normalizeGrade("2", "대왕중")).toBe("중2");
    expect(normalizeGrade("3", "대왕중")).toBe("중3");
  });

  it('정수 "1"/"2"/"3" + 학교 "○○중학교" → 중1/중2/중3', () => {
    expect(normalizeGrade("2", "휘문중학교")).toBe("중2");
  });

  it('정수 "1"/"2"/"3" + 학교 "○○고" → 고1/고2/고3', () => {
    expect(normalizeGrade("1", "휘문고")).toBe("고1");
    expect(normalizeGrade("2", "단대부고")).toBe("고2");
    expect(normalizeGrade("3", "휘문고등학교")).toBe("고3");
  });

  it("정수 + 학교 NULL → 고등부 추정 (학원 운영상 다수가 고등부)", () => {
    expect(normalizeGrade("1", null)).toBe("고1");
    expect(normalizeGrade("2", null)).toBe("고2");
    expect(normalizeGrade("3", null)).toBe("고3");
  });

  it("숫자 입력도 문자열과 동일하게 처리", () => {
    expect(normalizeGrade(1, "대왕중")).toBe("중1");
    expect(normalizeGrade(2, "휘문고")).toBe("고2");
    expect(normalizeGrade(3, null)).toBe("고3");
  });

  it('"4" → 재수', () => {
    expect(normalizeGrade("4", null)).toBe("재수");
    expect(normalizeGrade(4, "휘문고")).toBe("재수");
  });

  it('"0" / "5"~"10" / "졸" → 졸업 (장기 재수 통합)', () => {
    expect(normalizeGrade("0", null)).toBe("졸업");
    expect(normalizeGrade("5", null)).toBe("졸업");
    expect(normalizeGrade("8", null)).toBe("졸업");
    expect(normalizeGrade("10", null)).toBe("졸업");
    expect(normalizeGrade("졸", "휘문고")).toBe("졸업");
  });

  it("NULL / 공백 → 미정", () => {
    expect(normalizeGrade(null, null)).toBe("미정");
    expect(normalizeGrade(undefined, null)).toBe("미정");
    expect(normalizeGrade("", null)).toBe("미정");
    expect(normalizeGrade("   ", null)).toBe("미정");
  });

  it("알 수 없는 값 → 미정 (방어적)", () => {
    expect(normalizeGrade("abc", null)).toBe("미정");
    expect(normalizeGrade("고4", null)).toBe("미정");
    expect(normalizeGrade("고2반", null)).toBe("미정");
  });

  it('학교 suffix 1자 "중" 비교에서 "휘문고등학교" 가 잘못 매칭되지 않음', () => {
    // "휘문고등학교" 는 마지막 글자가 '교' 라 '중' 매칭 안 됨.
    expect(normalizeGrade("2", "휘문고등학교")).toBe("고2");
    // "○○중" 1자 suffix 와 다른 한자/문자: '중앙고' 의 '고' 마지막. '중' 끝 아님.
    expect(normalizeGrade("2", "중앙고")).toBe("고2");
  });
});

describe("import helpers · normalizeAmount", () => {
  it('"550,000" → 550000', () => {
    expect(normalizeAmount("550,000")).toBe(550000);
  });

  it('" ￦ 550,000 원 " → 550000', () => {
    expect(normalizeAmount(" ￦ 550,000 원 ")).toBe(550000);
  });

  it("숫자 그대로 수락", () => {
    expect(normalizeAmount(550000)).toBe(550000);
    expect(normalizeAmount(0)).toBe(0);
  });

  it("음수 → null", () => {
    expect(normalizeAmount(-100)).toBeNull();
    expect(normalizeAmount("-100")).toBeNull();
  });

  it('"abc" → null', () => {
    expect(normalizeAmount("abc")).toBeNull();
  });

  it("null / undefined → null", () => {
    expect(normalizeAmount(null)).toBeNull();
    expect(normalizeAmount(undefined)).toBeNull();
  });

  it("소수는 trunc (3.7 → 3)", () => {
    expect(normalizeAmount(3.7)).toBe(3);
    expect(normalizeAmount(550000.99)).toBe(550000);
  });

  it("빈 문자열 → null", () => {
    expect(normalizeAmount("")).toBeNull();
    expect(normalizeAmount("   ")).toBeNull();
  });
});

describe("import helpers · normalizeDate", () => {
  it('"2026-04-22" → "2026-04-22"', () => {
    expect(normalizeDate("2026-04-22")).toBe("2026-04-22");
  });

  it("/ 구분자 수락", () => {
    expect(normalizeDate("2026/04/22")).toBe("2026-04-22");
  });

  it(". 구분자 수락", () => {
    expect(normalizeDate("2026.04.22")).toBe("2026-04-22");
  });

  it("한자리 월/일 패딩", () => {
    expect(normalizeDate("2026-4-5")).toBe("2026-04-05");
  });

  it("Date 객체 (UTC) 수락", () => {
    // Date.UTC 로 생성해 formatYmd 의 UTC 기반 포맷과 정확히 매칭
    const d = new Date(Date.UTC(2026, 3, 22));
    expect(normalizeDate(d)).toBe("2026-04-22");
  });

  it("Excel serial 숫자 → YYYY-MM-DD 포맷 반환", () => {
    // 구현상 1899-12-30 기준. 함수 결과가 YYYY-MM-DD 포맷이기만 하면 OK.
    const out = normalizeDate(45017);
    expect(out).not.toBeNull();
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("Excel serial 25569 → 1970-01-01", () => {
    expect(normalizeDate(25569)).toBe("1970-01-01");
  });

  it("잘못된 월(13월) → null", () => {
    expect(normalizeDate("2026-13-01")).toBeNull();
  });

  it("잘못된 일(32일) → null", () => {
    expect(normalizeDate("2026-04-32")).toBeNull();
  });

  it("빈 문자열 / null / undefined → null", () => {
    expect(normalizeDate("")).toBeNull();
    expect(normalizeDate(null)).toBeNull();
    expect(normalizeDate(undefined)).toBeNull();
  });

  it('"xxx" → null', () => {
    expect(normalizeDate("xxx")).toBeNull();
  });

  it("Invalid Date → null", () => {
    expect(normalizeDate(new Date("invalid"))).toBeNull();
  });
});

describe("import helpers · emptyToNull", () => {
  it("빈 문자열 → null", () => {
    expect(emptyToNull("")).toBeNull();
  });

  it("공백 문자열 → null", () => {
    expect(emptyToNull("   ")).toBeNull();
    expect(emptyToNull("\t\n ")).toBeNull();
  });

  it("null / undefined → null", () => {
    expect(emptyToNull(null)).toBeNull();
    expect(emptyToNull(undefined)).toBeNull();
  });

  it("0 은 그대로 유지 (falsy 지만 유효값)", () => {
    expect(emptyToNull(0)).toBe(0);
  });

  it("일반 문자열은 그대로", () => {
    expect(emptyToNull("a")).toBe("a");
  });

  it("객체/배열 그대로 반환", () => {
    const obj = { a: 1 };
    expect(emptyToNull(obj)).toBe(obj);
  });
});
