import { describe, expect, it } from "vitest";
import {
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

  it("방배 외: 모든 status 가 '출석' 으로 매핑 (0066 결석 폐기)", () => {
    expect(effectiveAttendanceStatus("출석", "대치")).toBe("출석");
    expect(effectiveAttendanceStatus("지각", "대치")).toBe("출석");
    expect(effectiveAttendanceStatus("조퇴", "대치")).toBe("출석");
    expect(effectiveAttendanceStatus("보강", "대치")).toBe("출석");
    // raw 결석 row 가 남아 있어도 비-방배에선 '출석' chip 으로 흡수.
    expect(effectiveAttendanceStatus("결석", "대치")).toBe("출석");
  });

  it("미지정 분원도 비-strict 처리 (모두 출석)", () => {
    expect(effectiveAttendanceStatus("지각", null)).toBe("출석");
    expect(effectiveAttendanceStatus("결석", undefined)).toBe("출석");
  });
});
