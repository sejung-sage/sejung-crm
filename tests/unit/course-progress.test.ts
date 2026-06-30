import { describe, it, expect } from "vitest";
import {
  parseCourseProgress,
  isSeminarCourse,
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
