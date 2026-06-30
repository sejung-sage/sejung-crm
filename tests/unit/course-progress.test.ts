import { describe, it, expect } from "vitest";
import {
  parseCourseProgress,
  isSeminarCourse,
  isCourseOngoing,
} from "@/lib/profile/course-progress";

describe("parseCourseProgress · 강좌명 prefix", () => {
  it("(종)/(폐) prefix 면 closed", () => {
    expect(parseCourseProgress("(종)26#RY 수학")).toBe("closed");
    expect(parseCourseProgress("(폐)국어 정규")).toBe("closed");
    expect(parseCourseProgress("종)약식")).toBe("closed");
  });
  it("prefix 없으면 ongoing", () => {
    expect(parseCourseProgress("(충)26#SY 김강용T 수학 특강")).toBe("ongoing");
    expect(parseCourseProgress(null)).toBe("ongoing");
  });
});

describe("isSeminarCourse · 설명회 판정", () => {
  it("subject 가 '설명회'면 true", () => {
    expect(isSeminarCourse("설명회", "아무 강좌명")).toBe(true);
  });
  it("강좌명에 '설명회' 포함이면 true (subject NULL 보조)", () => {
    expect(
      isSeminarCourse(null, "[독학관] 송민정T 2028 입시전략 설명회 (6/22)"),
    ).toBe(true);
  });
  it("학업 과목은 false", () => {
    expect(isSeminarCourse("수학", "(종)26#RY 이경민T 중3 수학")).toBe(false);
    expect(isSeminarCourse(null, "(충)26#SY 김강용T 고2 수학 특강")).toBe(false);
  });

  it("회귀: 설명회는 (종) 없고 sentinel 이어도 진행 중이 아니어야 한다", () => {
    // 한승현 케이스 — 설명회, prefix 없음, end_date 2050 sentinel.
    const name = "[독학관] 고1,2 송민정T 2028 입시전략 설명회 월 PM 2:00 (6/22)";
    // prefix 파싱만 보면 ongoing 으로 잡히지만,
    expect(parseCourseProgress(name)).toBe("ongoing");
    // 설명회 판정으로 진행 중에서 제외돼야 한다.
    expect(isSeminarCourse("설명회", name)).toBe(true);
  });
});

describe("isCourseOngoing · 교집합(설명회+종강접두+end_date)", () => {
  const FUTURE = "2050-01-01"; // sentinel
  const PAST = "2000-01-01";

  it("접두 없음 + 미래/sentinel end_date → 진행 중", () => {
    expect(
      isCourseOngoing({ courseName: "26#SN 정훈구T 과탐 특강", subject: "과탐", endDate: FUTURE }),
    ).toBe(true);
    expect(
      isCourseOngoing({ courseName: "26#SN 수학", subject: "수학", endDate: null }),
    ).toBe(true);
  });

  it("회귀(신동아 [1-기말]): 접두 없어도 end_date 과거면 완료", () => {
    expect(
      isCourseOngoing({
        courseName: "26@RN 윤봉희T (단대1 통과) [1-기말] 7+1(직) 일 pm6-9 (5/10)",
        subject: "과탐",
        endDate: PAST,
      }),
    ).toBe(false);
  });

  it("종강 접두면 end_date 무관하게 완료", () => {
    expect(
      isCourseOngoing({ courseName: "종)26@RN 국어 [1-기말]", subject: "국어", endDate: FUTURE }),
    ).toBe(false);
  });

  it("설명회는 무조건 완료(진행 중 아님)", () => {
    expect(
      isCourseOngoing({ courseName: "2026 여름방학 설명회 3차", subject: "설명회", endDate: FUTURE }),
    ).toBe(false);
  });
});
