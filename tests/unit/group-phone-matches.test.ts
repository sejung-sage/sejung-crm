import { describe, it, expect } from "vitest";
import {
  groupPhoneMatches,
  type PhoneMatchRow,
} from "@/lib/students/group-phone-matches";

/**
 * 번호 → 학생 조회 결과 접기.
 *
 * 배경(프로덕션 실측 2026-08-20): 학부모 번호 하나로 조회하면 같은 학생이
 * 분원마다 별도 행으로 잡힌다(각기 다른 aca2000_id). 접지 않으면 수신거부
 * 등록 화면이 "이 번호의 학생 5명"(실제 형제 2명)이라고 띄운다.
 */

const PARENT = "01047384727";

function row(p: Partial<PhoneMatchRow>): PhoneMatchRow {
  return {
    id: p.id ?? "id-" + Math.random().toString(36).slice(2),
    name: p.name ?? null,
    school: p.school ?? null,
    grade: p.grade ?? null,
    branch: p.branch ?? null,
    status: p.status ?? null,
    parent_phone: p.parent_phone !== undefined ? p.parent_phone : PARENT,
    phone: p.phone ?? null,
  };
}

describe("groupPhoneMatches", () => {
  it("같은 학생의 분원별 중복 등록을 한 명으로 접고 분원을 합친다", () => {
    // 실제 데이터 형태: 이지우가 반포/방배/대치 3행
    const out = groupPhoneMatches(
      [
        row({ name: "이지우", school: "세화여고", grade: "고2", branch: "반포", status: "수강이력자" }),
        row({ name: "이지우", school: "세화여고", grade: "고2", branch: "방배", status: "수강 x" }),
        row({ name: "이지우", school: "고", grade: "고2", branch: "대치", status: "수강 x" }),
      ],
      PARENT,
    );
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("이지우");
    expect(out[0].branches).toEqual(["반포", "방배", "대치"]);
  });

  it("형제는 이름이 다르므로 따로 유지된다", () => {
    const out = groupPhoneMatches(
      [
        row({ name: "이지우", grade: "고2", branch: "반포" }),
        row({ name: "이정빈", grade: "졸업", branch: "대치" }),
        row({ name: "이지우", grade: "고2", branch: "대치" }),
      ],
      PARENT,
    );
    expect(out.map((s) => s.name)).toEqual(["이지우", "이정빈"]);
    expect(out[0].branches).toEqual(["반포", "대치"]);
  });

  it("학교가 미기입 placeholder('고')면 구체적인 값으로 승격한다", () => {
    const out = groupPhoneMatches(
      [
        row({ name: "이지우", school: "고", branch: "대치" }),
        row({ name: "이지우", school: "세화여고", branch: "반포" }),
      ],
      PARENT,
    );
    expect(out[0].school).toBe("세화여고");
  });

  it("구체적인 학교가 먼저 오면 placeholder 로 덮어쓰지 않는다", () => {
    const out = groupPhoneMatches(
      [
        row({ name: "이지우", school: "세화여고", branch: "반포" }),
        row({ name: "이지우", school: "고", branch: "대치" }),
      ],
      PARENT,
    );
    expect(out[0].school).toBe("세화여고");
  });

  it("학년이 '미정'/NULL 이면 구체적인 값으로 승격한다", () => {
    const out = groupPhoneMatches(
      [
        row({ name: "이정빈", grade: "미정", branch: "반포" }),
        row({ name: "이정빈", grade: "졸업", branch: "대치" }),
      ],
      PARENT,
    );
    expect(out[0].grade).toBe("졸업");
  });

  it("학부모 번호로 걸렸는지 학생 본인 번호로 걸렸는지 구분한다", () => {
    const out = groupPhoneMatches(
      [
        row({ name: "김학생", parent_phone: null, phone: PARENT }),
      ],
      PARENT,
    );
    expect(out[0].matchedAs).toBe("학생");
  });

  it("이름이 없으면 id 로 구분해 서로 접히지 않는다", () => {
    const out = groupPhoneMatches(
      [row({ id: "a", name: null }), row({ id: "b", name: null })],
      PARENT,
    );
    expect(out).toHaveLength(2);
  });

  it("빈 입력은 빈 배열", () => {
    expect(groupPhoneMatches([], PARENT)).toEqual([]);
  });

  it("분원이 NULL 이면 branches 에 넣지 않는다", () => {
    const out = groupPhoneMatches([row({ name: "김학생", branch: null })], PARENT);
    expect(out[0].branches).toEqual([]);
  });
});
