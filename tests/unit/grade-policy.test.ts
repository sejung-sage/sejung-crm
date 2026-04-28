import { describe, it, expect } from "vitest";
import { normalizeGrade } from "@/lib/schemas/import";
import {
  GRADE_VALUES,
  HIDDEN_GRADES_BY_DEFAULT,
  SCHOOL_LEVEL_VALUES,
  type Grade,
  type SchoolLevel,
} from "@/lib/schemas/common";

/**
 * 0012 마이그레이션 · 학년 정규화 정책 (single-source-of-truth) 검증.
 *
 * 검증 대상:
 *  1. TS  : src/lib/schemas/import.ts  · normalizeGrade(rawGrade, school)
 *  2. SQL : supabase/migrations/0012_students_normalized_grade.sql
 *           · public.normalize_student_grade(grade_raw, school)
 *           · public.derive_school_level(grade_raw, school)
 *  3. Py  : scripts/etl/grade_policy.py
 *           · normalize_grade(grade_raw, school)
 *           · derive_school_level(grade_raw, school)
 *
 * 본 테스트는 TS 함수만 호출하지만, 케이스 표는 SQL/Python 정의와
 * 1:1 동일하게 작성되어 있다. 한 쪽만 바뀌면 즉시 깨지도록 설계.
 *
 * SQL/Python 헬퍼는 vitest 에서 직접 호출 불가 → 별도 self-test
 * (Python: __main__) + 본 테스트의 케이스 표 동기화로 정합성 보장.
 */

// ─── 0) 공통 enum 타입 정합성 ───────────────────────────────

describe("0012 정규화 enum · 공통 상수", () => {
  it("GRADE_VALUES 는 9종 (중1~고3/재수/졸업/미정)", () => {
    expect(GRADE_VALUES).toEqual([
      "중1",
      "중2",
      "중3",
      "고1",
      "고2",
      "고3",
      "재수",
      "졸업",
      "미정",
    ]);
    expect(GRADE_VALUES.length).toBe(9);
  });

  it("SCHOOL_LEVEL_VALUES 는 3종 (중/고/기타)", () => {
    expect(SCHOOL_LEVEL_VALUES).toEqual(["중", "고", "기타"]);
  });

  it("HIDDEN_GRADES_BY_DEFAULT 는 졸업·미정 만 포함", () => {
    expect(HIDDEN_GRADES_BY_DEFAULT).toEqual(["졸업", "미정"]);
    // 정규 운영 학년이 hidden 에 들어가면 안 됨.
    for (const g of ["중1", "중2", "중3", "고1", "고2", "고3", "재수"] as const) {
      expect(HIDDEN_GRADES_BY_DEFAULT.includes(g)).toBe(false);
    }
  });
});

// ─── 1) 정규화 룰 · 표 기반 검증 ─────────────────────────────

/**
 * SQL/Python 미러와 1:1 동일한 케이스 표.
 * grade_raw 와 school 에서 (grade, school_level) 로의 결정을
 * 한 곳에서 표로 보고 깨지면 한 줄만 고치도록.
 */
type Case = {
  rawGrade: string | number | null | undefined;
  school: string | null | undefined;
  expectedGrade: Grade;
  /**
   * SQL derive_school_level 의 결과(검증 참고용).
   * normalizeGrade 의 결과만으로 SchoolLevel 을 직접 도출하지 못하므로
   * 시드(students.school_level) 또는 SQL 함수가 책임지는 값을 표로 둔다.
   */
  expectedSchoolLevel: SchoolLevel;
  desc: string;
};

const cases: Case[] = [
  // 1. 정수 + 학교 suffix '중' → 중X
  {
    rawGrade: "1",
    school: "대왕중",
    expectedGrade: "중1",
    expectedSchoolLevel: "중",
    desc: "'1' + '대왕중' (1자 suffix) → 중1",
  },
  {
    rawGrade: "2",
    school: "휘문중학교",
    expectedGrade: "중2",
    expectedSchoolLevel: "중",
    desc: "'2' + '휘문중학교' (full suffix) → 중2",
  },
  {
    rawGrade: "3",
    school: "대왕중",
    expectedGrade: "중3",
    expectedSchoolLevel: "중",
    desc: "'3' + '대왕중' → 중3",
  },

  // 2. 정수 + 학교 suffix '고' / '고등학교' → 고X
  {
    rawGrade: "3",
    school: "단대부고",
    expectedGrade: "고3",
    expectedSchoolLevel: "고",
    desc: "'3' + '단대부고' → 고3",
  },
  {
    rawGrade: "1",
    school: "휘문고등학교",
    expectedGrade: "고1",
    expectedSchoolLevel: "고",
    desc: "'1' + '휘문고등학교' (full suffix) → 고1",
  },
  {
    rawGrade: "2",
    school: "대왕고",
    expectedGrade: "고2",
    expectedSchoolLevel: "고",
    desc: "'대왕고' (마지막 글자 '고', 중 아님) → 고2",
  },

  // 3. 정수 + 학교 NULL → 고등부 추정 (학원 운영 특성)
  {
    rawGrade: "1",
    school: null,
    expectedGrade: "고1",
    expectedSchoolLevel: "고",
    desc: "'1' + NULL → 고1 (고등부 추정)",
  },
  {
    rawGrade: "2",
    school: null,
    expectedGrade: "고2",
    expectedSchoolLevel: "고",
    desc: "'2' + NULL → 고2 (고등부 추정)",
  },
  {
    rawGrade: "3",
    school: null,
    expectedGrade: "고3",
    expectedSchoolLevel: "고",
    desc: "'3' + NULL → 고3 (고등부 추정)",
  },

  // 4. 재수 ('4')
  {
    rawGrade: "4",
    school: "휘문고",
    expectedGrade: "재수",
    expectedSchoolLevel: "고",
    desc: "'4' + 학교 → 재수",
  },
  {
    rawGrade: "4",
    school: null,
    expectedGrade: "재수",
    expectedSchoolLevel: "고",
    desc: "'4' + NULL → 재수 (고 추정)",
  },

  // 5. 졸업 (장기 재수 통합: '0', '5'~'10', '졸')
  {
    rawGrade: "0",
    school: "휘문고",
    expectedGrade: "졸업",
    expectedSchoolLevel: "고",
    desc: "'0' → 졸업",
  },
  {
    rawGrade: "5",
    school: null,
    expectedGrade: "졸업",
    expectedSchoolLevel: "고",
    desc: "'5' → 졸업",
  },
  {
    rawGrade: "10",
    school: null,
    expectedGrade: "졸업",
    expectedSchoolLevel: "고",
    desc: "'10' → 졸업",
  },
  {
    rawGrade: "졸",
    school: null,
    expectedGrade: "졸업",
    expectedSchoolLevel: "고",
    desc: "'졸' → 졸업 (한글 표기)",
  },
  {
    rawGrade: "졸",
    school: "휘문고",
    expectedGrade: "졸업",
    expectedSchoolLevel: "고",
    desc: "'졸' + 학교 → 졸업",
  },

  // 6. 명시적 한글 표기 '고3'
  {
    rawGrade: "고3",
    school: null,
    expectedGrade: "고3",
    expectedSchoolLevel: "고",
    desc: "'고3' → 고3 (명시 표기)",
  },

  // 7. 미정 (NULL/공백/알 수 없음)
  {
    rawGrade: null,
    school: null,
    expectedGrade: "미정",
    expectedSchoolLevel: "기타",
    desc: "NULL + NULL → 미정",
  },
  {
    rawGrade: null,
    school: "대왕중",
    // grade_raw 가 NULL 이면 학교가 중학교여도 학년 결정 불가 → 미정.
    // (school_level 은 학교 suffix '중' 으로 '중' 도출되지만, grade 본인은 '미정'.)
    expectedGrade: "미정",
    expectedSchoolLevel: "중",
    desc: "NULL + '대왕중' → 미정 (학년 자체는 알 수 없음, school_level=중)",
  },
  {
    rawGrade: "  ",
    school: null,
    expectedGrade: "미정",
    expectedSchoolLevel: "기타",
    desc: "공백 → 미정",
  },
  {
    rawGrade: "abc",
    school: null,
    expectedGrade: "미정",
    expectedSchoolLevel: "기타",
    desc: "'abc' (알 수 없음) → 미정",
  },
  {
    rawGrade: "고4",
    school: null,
    expectedGrade: "미정",
    expectedSchoolLevel: "고",
    desc: "'고4' (존재 안 하는 학년) → 미정",
  },

  // 8. 숫자 타입 입력
  {
    rawGrade: 1,
    school: "대왕중",
    expectedGrade: "중1",
    expectedSchoolLevel: "중",
    desc: "숫자 1 + '대왕중' → 중1",
  },
  {
    rawGrade: 2,
    school: null,
    expectedGrade: "고2",
    expectedSchoolLevel: "고",
    desc: "숫자 2 + NULL → 고2",
  },

  // 9. idempotent : 이미 정규화된 enum 값 입력
  {
    rawGrade: "중2",
    school: null,
    expectedGrade: "중2",
    expectedSchoolLevel: "중",
    desc: "이미 정규화된 '중2' → 그대로 (idempotent)",
  },
  {
    rawGrade: "중2",
    school: "대왕중",
    expectedGrade: "중2",
    expectedSchoolLevel: "중",
    desc: "'중2' + '대왕중' → 중2 (idempotent + 일관)",
  },
  {
    rawGrade: "고1",
    school: null,
    expectedGrade: "고1",
    expectedSchoolLevel: "고",
    desc: "'고1' → 고1 (idempotent)",
  },
  {
    rawGrade: "재수",
    school: null,
    expectedGrade: "재수",
    expectedSchoolLevel: "고",
    desc: "'재수' → 재수 (idempotent)",
  },
  {
    rawGrade: "졸업",
    school: null,
    expectedGrade: "졸업",
    expectedSchoolLevel: "고",
    desc: "'졸업' → 졸업 (idempotent)",
  },
  {
    rawGrade: "미정",
    school: null,
    expectedGrade: "미정",
    expectedSchoolLevel: "기타",
    desc: "'미정' → 미정 (idempotent)",
  },
];

describe("normalizeGrade · 표 기반 정규화 룰 (DB/Python 미러와 1:1)", () => {
  for (const c of cases) {
    it(c.desc, () => {
      const got = normalizeGrade(c.rawGrade, c.school);
      expect(got).toBe(c.expectedGrade);
      // 결과가 항상 9종 enum 안에 있는지 (CHECK 제약 충족 보장).
      expect(GRADE_VALUES).toContain(got);
    });
  }
});

// ─── 2) 경계값 추가 검증 ─────────────────────────────────────

describe("normalizeGrade · 경계값", () => {
  it("학교명 공백 trim 후 suffix 비교: '  대왕중  ' 도 '중' 매칭", () => {
    // SQL 의 RIGHT(TRIM(school), 1) = '중' 와 동일 정책. TS 는
    // String(school).trim() 후 비교하므로 공백 padding 도 OK.
    expect(normalizeGrade("2", "  대왕중  ")).toBe("중2");
  });

  it("학교 빈 문자열 → 학교 NULL 과 동일 처리", () => {
    expect(normalizeGrade("2", "")).toBe("고2");
    expect(normalizeGrade("2", "   ")).toBe("고2");
  });

  it("학교가 '중' 으로 끝나지 않는 일반 단어 (예: '중앙고') → '고'", () => {
    // '중앙고' 의 마지막 글자는 '고' 이지 '중' 아님.
    expect(normalizeGrade("2", "중앙고")).toBe("고2");
  });

  it("학교가 '고' 1자 인 비현실 케이스도 안전 처리", () => {
    // 마지막 글자 '고' → 고로 분류 (방어적).
    expect(normalizeGrade("3", "고")).toBe("고3");
  });

  it("undefined 입력 (필드 누락 시뮬레이션)", () => {
    expect(normalizeGrade(undefined, undefined)).toBe("미정");
    expect(normalizeGrade(undefined, "대왕중")).toBe("미정");
  });

  it("아주 큰 정수 (예: '99') → 미정 (0/5~10 외 범위)", () => {
    // SQL 의 IN ('0','5','6','7','8','9','10') 와 1:1.
    expect(normalizeGrade("99", null)).toBe("미정");
    expect(normalizeGrade("11", null)).toBe("미정");
    expect(normalizeGrade("-1", null)).toBe("미정");
  });

  it("재실행 안전성: 같은 입력을 두 번 정규화해도 동일", () => {
    // 다른 양식의 입력이 모두 같은 enum 값으로 수렴.
    const a = normalizeGrade("2", "대왕중");
    const b = normalizeGrade(a, "대왕중");
    const c = normalizeGrade(b, null);
    expect(a).toBe("중2");
    expect(b).toBe("중2");
    expect(c).toBe("중2");
  });
});

// ─── 3) 결과 도메인 보장 (DB CHECK 통과) ────────────────────

describe("normalizeGrade · 결과 도메인", () => {
  it("어떤 입력이든 결과는 9종 enum 안 (null/예외 절대 없음)", () => {
    const wildInputs: Array<unknown> = [
      null,
      undefined,
      "",
      "   ",
      "abc",
      "고4",
      "중4",
      "졸업생",
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "10",
      "99",
      0,
      1,
      99,
      -5,
      "고3",
      "졸",
      "  중1  ",
    ];
    for (const v of wildInputs) {
      const got = normalizeGrade(
        v as string | number | null | undefined,
        null,
      );
      expect(GRADE_VALUES).toContain(got);
    }
  });

  it("어떤 학교 입력이든 예외 없이 enum 값 반환", () => {
    const wildSchools: Array<string | null | undefined> = [
      null,
      undefined,
      "",
      "   ",
      "휘문고",
      "휘문고등학교",
      "대왕중",
      "대왕중학교",
      "중앙고",
      "중", // 1자
      "고", // 1자
      "기타학교명",
    ];
    for (const s of wildSchools) {
      const got = normalizeGrade("2", s);
      expect(GRADE_VALUES).toContain(got);
    }
  });
});
