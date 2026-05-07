import { describe, expect, it } from "vitest";
import { parseCourseName } from "@/lib/profile/parse-course-name";

/**
 * `parse-course-name` 회귀 테스트.
 *
 * 운영 raw `course_name` 패턴은 ETL `migrate_classes.py:_SUBJECT_ALIASES` 와
 * 정렬되어 있다. 새 raw 패턴이 등장하면 본 모듈 + alias dict 양쪽을 함께 확장.
 */

describe("parseCourseName", () => {
  it("일반 패턴: 분원코드·선생님T·과목 추출", () => {
    const r = parseCourseName(
      "26@RN 써니T 세화여고1 국어 1학기 기말 (7+1회) 토 A10-1 (5/16)",
    );
    expect(r.teacher).toBe("써니");
    expect(r.subject).toBe("국어");
  });

  it("(종) prefix 가 붙어도 strip 후 정상 추출", () => {
    const r = parseCourseName(
      "(종) 26@RN 박정인T 세화여고1 영어 1학기 중간 (7+1회) 일 P1:30-4:30 (3/08)",
    );
    expect(r.teacher).toBe("박정인");
    expect(r.subject).toBe("영어");
  });

  it("종) (앞 괄호 누락) 변형도 strip", () => {
    const r = parseCourseName(
      "종) 26@RN 써니T 세화여고1 국어 1학기 중간 (6+1회) 토 A10-1 (3/14)",
    );
    expect(r.teacher).toBe("써니");
    expect(r.subject).toBe("국어");
  });

  it("(폐) prefix 도 strip", () => {
    const r = parseCourseName(
      "(폐) 26@RN 김선생T 세화여고1 수학 1학기 (3회) 월 A9-12 (3/01)",
    );
    expect(r.teacher).toBe("김선생");
    expect(r.subject).toBe("수학");
  });

  it("통합과학 / 통과 → 과탐 정규화", () => {
    expect(
      parseCourseName(
        "26@RN 박천익T 세화여고1 통합과학 1학기 기말 (7+1회) 토 P2-5 (5/16)",
      ).subject,
    ).toBe("과탐");
    expect(
      parseCourseName(
        "26#SN 양장섭T 고1 과탐 통과 기말킬러 운동량과충격량 (1회) 토 A10-1 (5/2)",
      ).subject,
    ).toBe("과탐");
  });

  it("화학·생명과학·물리 → 과탐", () => {
    expect(parseCourseName("26#SN 김T 고1 화학 정규반").subject).toBe("과탐");
    expect(parseCourseName("26#SN 김T 고1 생명과학 정규반").subject).toBe(
      "과탐",
    );
    expect(parseCourseName("26#SN 김T 고1 물리 정규반").subject).toBe("과탐");
  });

  it("통사·통사+한국사 → 사탐", () => {
    expect(parseCourseName("26#SN 김T 고1 통사 정규반").subject).toBe("사탐");
    expect(parseCourseName("26#SN 김T 고1 통사+한국사 강의").subject).toBe(
      "사탐",
    );
  });

  it("수능 prefix(수능국어/영어/수학) 도 본 과목으로", () => {
    expect(parseCourseName("26#SN 김T 고3 수능국어").subject).toBe("국어");
    expect(parseCourseName("26#SN 김T 고3 수능영어").subject).toBe("영어");
    expect(parseCourseName("26#SN 김T 고3 수능수학").subject).toBe("수학");
  });

  it("독학관 / 약술 / 논술 → 기타", () => {
    expect(parseCourseName("26@RN 박T 독학관 자율학습").subject).toBe("기타");
    expect(parseCourseName("26@RN 박T 약술 강의").subject).toBe("기타");
  });

  it("매칭 실패 시 null", () => {
    expect(parseCourseName("자유형 무패턴 강좌 이름").teacher).toBeNull();
    expect(parseCourseName("자유형 무패턴 강좌 이름").subject).toBeNull();
    expect(parseCourseName(null).teacher).toBeNull();
    expect(parseCourseName("").subject).toBeNull();
  });

  it("선생님 토큰 없으면 teacher 만 null, subject 는 살아있어야 함", () => {
    const r = parseCourseName("고1 수학 정규반 (10회)");
    expect(r.teacher).toBeNull();
    expect(r.subject).toBe("수학");
  });
});
