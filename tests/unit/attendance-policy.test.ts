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

describe("computeAttendanceRate", () => {
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
