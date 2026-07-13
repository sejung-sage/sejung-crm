import { describe, it, expect } from "vitest";
import { countEnrolledUnion } from "@/lib/classes/list-classes";

/**
 * 강좌 목록 "수강생" 카운트 = ACA 등록 ∪ CRM 신청 (student_id 합집합).
 *
 * 회귀 방어: 설명회 목록 카운트가 ACA 한쪽만 세던 버그(2026-07-13). 상세 KPI
 * (class-kpi-cards)는 두 소스를 합집합으로 세는데 목록은 안 그래서 숫자가 어긋났다.
 * 일반 강좌(신청 없음)는 종전과 동일해야 한다.
 */

const enrolled = (m: Record<string, string[]>) =>
  new Map(Object.entries(m).map(([k, v]) => [k, new Set(v)]));
const signup = enrolled;

describe("countEnrolledUnion", () => {
  it("일반 강좌(신청 없음) → ACA 등록 수 그대로", () => {
    const c = { id: "c1", aca_class_id: "aca1" };
    expect(
      countEnrolledUnion(c, enrolled({ aca1: ["s1", "s2", "s3"] }), signup({})),
    ).toBe(3);
  });

  it("설명회 → ACA + CRM 합집합, 겹치는 학생은 1명", () => {
    const c = { id: "c1", aca_class_id: "aca1" };
    // ACA: s1,s2,s3 / CRM: s3,s4 → 합집합 s1,s2,s3,s4 = 4
    expect(
      countEnrolledUnion(
        c,
        enrolled({ aca1: ["s1", "s2", "s3"] }),
        signup({ c1: ["s3", "s4"] }),
      ),
    ).toBe(4);
  });

  it("ACA 등록 0(aca_class_id NULL)인데 CRM 신청만 있는 설명회 → 신청 수", () => {
    const c = { id: "c1", aca_class_id: null };
    expect(
      countEnrolledUnion(c, enrolled({}), signup({ c1: ["s1", "s2"] })),
    ).toBe(2);
  });

  it("양쪽 다 없음 → 0", () => {
    const c = { id: "c1", aca_class_id: "aca1" };
    expect(countEnrolledUnion(c, enrolled({}), signup({})).valueOf()).toBe(0);
  });

  it("신청 집합이 비어 있으면(size 0) ACA 수 그대로", () => {
    const c = { id: "c1", aca_class_id: "aca1" };
    expect(
      countEnrolledUnion(
        c,
        enrolled({ aca1: ["s1", "s2"] }),
        signup({ c1: [] }),
      ),
    ).toBe(2);
  });
});
