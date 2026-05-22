import { describe, it, expect } from "vitest";
import {
  applyDateToken,
  applyNameToken,
  hasDateToken,
  hasNameToken,
  toSendonNameSyntax,
} from "@/lib/messaging/personalize";

/**
 * 발송 본문 변수 치환 (personalize) 단위 테스트.
 *
 * 검증 대상:
 *   - hasNameToken / hasDateToken : 토큰 유무 boolean
 *   - applyDateToken              : KST 'M월 D일' 형태
 *   - applyNameToken              : null/공백 → '학부모님' fallback
 *   - toSendonNameSyntax          : {이름} → #{이름} (sendon 치환 문법 변환)
 */

describe("hasNameToken / hasDateToken", () => {
  it("토큰 포함 → true", () => {
    expect(hasNameToken("안녕하세요 {이름}님")).toBe(true);
    expect(hasDateToken("{날짜} 수업 안내")).toBe(true);
  });

  it("토큰 미포함 → false", () => {
    expect(hasNameToken("안녕하세요 학부모님")).toBe(false);
    expect(hasDateToken("오늘 수업 안내")).toBe(false);
  });

  it("다른 토큰만 있는 경우 → false (서로 영향 없음)", () => {
    expect(hasNameToken("{날짜} 안내")).toBe(false);
    expect(hasDateToken("{이름}님께")).toBe(false);
  });
});

describe("applyDateToken · KST 'M월 D일'", () => {
  it("5월 22일 KST → '5월 22일' 로 치환", () => {
    // 한국 시각 2026-05-22 정오 = UTC 03:00 → KST 12:00.
    // 어떤 호스트 TZ 에서 돌리든 Asia/Seoul 변환 결과가 동일해야 한다.
    const kstNoon = new Date("2026-05-22T03:00:00Z");
    expect(applyDateToken("오늘 {날짜} 수업", kstNoon)).toBe(
      "오늘 5월 22일 수업",
    );
  });

  it("UTC 자정 직전이라도 KST 기준 다음 날로 표기", () => {
    // UTC 2026-05-21 23:30 = KST 2026-05-22 08:30
    const utcLateNight = new Date("2026-05-21T23:30:00Z");
    expect(applyDateToken("{날짜}", utcLateNight)).toBe("5월 22일");
  });

  it("다중 토큰 모두 치환", () => {
    const d = new Date("2026-05-22T03:00:00Z");
    expect(applyDateToken("{날짜} / {날짜}", d)).toBe("5월 22일 / 5월 22일");
  });

  it("토큰 없으면 원문 그대로 반환", () => {
    const d = new Date("2026-05-22T03:00:00Z");
    expect(applyDateToken("토큰 없음", d)).toBe("토큰 없음");
  });
});

describe("applyNameToken · '{이름}' 치환", () => {
  it("정상 이름 치환", () => {
    expect(applyNameToken("{이름}님 안녕하세요", "홍길동")).toBe(
      "홍길동님 안녕하세요",
    );
  });

  it("name=null → '학부모님' fallback (token 자리에만 치환)", () => {
    // '{이름}' 자리에 '학부모님' 이 들어가므로 '{이름}님' 은 '학부모님님' 이 된다.
    // fallback 의 의미: name 자체가 없을 때 표시할 호칭. 본문 작성자가
    // '{이름}님' 처럼 호칭을 덧붙여 쓰는 경우 안내 책임은 UI 측.
    expect(applyNameToken("{이름} 안녕하세요", null)).toBe(
      "학부모님 안녕하세요",
    );
  });

  it("name 공백만 → '학부모님' fallback", () => {
    expect(applyNameToken("{이름}", "   ")).toBe("학부모님");
  });

  it("이름에 앞뒤 공백 → trim 적용", () => {
    expect(applyNameToken("{이름}님", "  김철수  ")).toBe("김철수님");
  });

  it("다중 토큰 모두 치환", () => {
    expect(applyNameToken("{이름} / {이름}", "이서연")).toBe(
      "이서연 / 이서연",
    );
  });

  it("토큰 없으면 원문 그대로 반환", () => {
    expect(applyNameToken("토큰 없음", "홍길동")).toBe("토큰 없음");
  });
});

describe("toSendonNameSyntax · {이름} → #{이름}", () => {
  it("단일 토큰 변환", () => {
    expect(toSendonNameSyntax("{이름}")).toBe("#{이름}");
  });

  it("다중 토큰 모두 변환", () => {
    expect(toSendonNameSyntax("{이름} 안녕 {이름}")).toBe("#{이름} 안녕 #{이름}");
  });

  it("토큰 없으면 원문 그대로 반환", () => {
    expect(toSendonNameSyntax("안녕하세요 학부모님")).toBe(
      "안녕하세요 학부모님",
    );
  });

  it("주변 텍스트와 자연스럽게 결합", () => {
    expect(toSendonNameSyntax("{이름}님 5월 22일 수업 안내")).toBe(
      "#{이름}님 5월 22일 수업 안내",
    );
  });
});
