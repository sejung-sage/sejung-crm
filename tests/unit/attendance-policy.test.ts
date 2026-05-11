import { describe, expect, it } from "vitest";
import {
  computeAttendanceRate,
  effectiveAttendanceStatus,
  isStrictAttendanceBranch,
} from "@/lib/profile/attendance-policy";

describe("isStrictAttendanceBranch", () => {
  it("방배만 strict 5종", () => {
    expect(isStrictAttendanceBranch("방배")).toBe(true);
    expect(isStrictAttendanceBranch("대치")).toBe(false);
    expect(isStrictAttendanceBranch("송도")).toBe(false);
    expect(isStrictAttendanceBranch("반포")).toBe(false);
  });

  it("null/undefined/빈 문자열은 비-strict", () => {
    expect(isStrictAttendanceBranch(null)).toBe(false);
    expect(isStrictAttendanceBranch(undefined)).toBe(false);
    expect(isStrictAttendanceBranch("")).toBe(false);
  });
});

describe("effectiveAttendanceStatus", () => {
  it("방배: 5종 raw 그대로", () => {
    for (const s of ["출석", "지각", "결석", "조퇴", "보강"] as const) {
      expect(effectiveAttendanceStatus(s, "방배")).toBe(s);
    }
  });

  it("방배 외: 결석만 결석, 나머지는 출석", () => {
    expect(effectiveAttendanceStatus("출석", "대치")).toBe("출석");
    expect(effectiveAttendanceStatus("지각", "대치")).toBe("출석");
    expect(effectiveAttendanceStatus("조퇴", "대치")).toBe("출석");
    expect(effectiveAttendanceStatus("보강", "대치")).toBe("출석");
    expect(effectiveAttendanceStatus("결석", "대치")).toBe("결석");
  });

  it("미지정 분원도 비-strict 처리", () => {
    expect(effectiveAttendanceStatus("지각", null)).toBe("출석");
    expect(effectiveAttendanceStatus("결석", undefined)).toBe("결석");
  });
});

describe("computeAttendanceRate · attendance row 기반 (expectedTotal 미지정)", () => {
  const counts = { attended: 7, late: 1, absent: 1, earlyLeave: 0, makeup: 1 };
  // total = 10. 결석 1.

  it("방배: (출석+지각+보강)/전체", () => {
    // (7+1+1)/10 = 0.9 → 90.0
    expect(computeAttendanceRate(counts, "방배")).toBe(90.0);
  });

  it("방배 외: (전체-결석)/전체 = (10-1)/10 = 90.0 (이 케이스에선 같은 값)", () => {
    expect(computeAttendanceRate(counts, "대치")).toBe(90.0);
  });

  it("조퇴가 있는 경우 분원별 결과가 달라짐", () => {
    const c = { attended: 7, late: 0, absent: 1, earlyLeave: 2, makeup: 0 };
    // total=10, 결석=1
    // 방배: (7+0+0)/10 = 70.0  ← 조퇴는 비출석
    // 그 외: (10-1)/10 = 90.0  ← 조퇴도 출석
    expect(computeAttendanceRate(c, "방배")).toBe(70.0);
    expect(computeAttendanceRate(c, "대치")).toBe(90.0);
  });

  it("전체가 0 이면 null", () => {
    const empty = { attended: 0, late: 0, absent: 0, earlyLeave: 0, makeup: 0 };
    expect(computeAttendanceRate(empty, "방배")).toBeNull();
    expect(computeAttendanceRate(empty, "대치")).toBeNull();
  });

  it("결석만 있으면 0%", () => {
    const c = { attended: 0, late: 0, absent: 5, earlyLeave: 0, makeup: 0 };
    expect(computeAttendanceRate(c, "방배")).toBe(0);
    expect(computeAttendanceRate(c, "대치")).toBe(0);
  });

  it("결석 0 이면 100%", () => {
    const c = { attended: 8, late: 1, absent: 0, earlyLeave: 1, makeup: 0 };
    expect(computeAttendanceRate(c, "방배")).toBe(90.0); // (8+1+0)/10
    expect(computeAttendanceRate(c, "대치")).toBe(100); // (10-0)/10
  });
});

describe("computeAttendanceRate · expectedTotal (enrollment_count) 기반", () => {
  it("비-방배: 김도윤 케이스 — 5 수강 / 1 결석 → 80%", () => {
    const c = { attended: 0, late: 0, absent: 1, earlyLeave: 0, makeup: 0 };
    // (5 - 1) / 5 = 80.0
    expect(computeAttendanceRate(c, "대치", 5)).toBe(80.0);
  });

  it("비-방배: 김태영 케이스 — 14 수강 / 2 결석 → 85.7%", () => {
    const c = { attended: 0, late: 0, absent: 2, earlyLeave: 0, makeup: 0 };
    // (14 - 2) / 14 = 0.857142... → 85.7
    expect(computeAttendanceRate(c, "반포", 14)).toBe(85.7);
  });

  it("비-방배: 결석 0 이면 100% (출결 row 자체가 없어도)", () => {
    const c = { attended: 0, late: 0, absent: 0, earlyLeave: 0, makeup: 0 };
    expect(computeAttendanceRate(c, "대치", 5)).toBe(100);
  });

  it("비-방배: 결석이 enrollment 보다 많으면 0% 클램프 (데이터 비정상)", () => {
    const c = { attended: 0, late: 0, absent: 7, earlyLeave: 0, makeup: 0 };
    expect(computeAttendanceRate(c, "대치", 5)).toBe(0);
  });

  it("비-방배: enrollment 0 이면 null (데이터 없음)", () => {
    const c = { attended: 0, late: 0, absent: 0, earlyLeave: 0, makeup: 0 };
    expect(computeAttendanceRate(c, "대치", 0)).toBeNull();
  });

  it("방배: expectedTotal 무시 — 항상 attendance row 기반", () => {
    const c = { attended: 0, late: 0, absent: 1, earlyLeave: 0, makeup: 0 };
    // 방배는 row 기반 룰 유지: (0+0+0)/1 = 0%
    expect(computeAttendanceRate(c, "방배", 5)).toBe(0);
  });
});
