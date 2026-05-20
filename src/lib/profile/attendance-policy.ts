/**
 * 분원별 출석 정책 (단일 소스).
 *
 * 운영 정책:
 *   "방배" 분원은 5종 status (출석/지각/결석/조퇴/보강) 를 그대로 운영하며
 *   그리드 chip 도 5종 그대로 노출한다.
 *
 *   그 외 분원(대치/송도/반포): "결석" 만 그대로, 나머지는 모두 "출석" 으로
 *   정규화해서 그리드 chip 렌더. (출석률 % 는 0063 에서 폐기.)
 */

import type { AttendanceStatus } from "@/types/database";

/**
 * 5종 status 를 raw 그대로 노출하는 분원 화이트리스트.
 * 현재는 "방배" 1곳. 추후 정책 변경 시 본 set 만 수정 → 모든 호출부에 일괄 반영.
 */
const STRICT_ATTENDANCE_BRANCHES: ReadonlySet<string> = new Set(["방배"]);

/** 분원이 5종 raw 출석을 그대로 운영하는지 여부. branch 가 빈 값이면 false. */
export function isStrictAttendanceBranch(
  branch: string | null | undefined,
): boolean {
  if (!branch) return false;
  return STRICT_ATTENDANCE_BRANCHES.has(branch);
}

/**
 * 표시용 출석 status 정규화.
 *
 * 방배: raw status 그대로.
 * 그 외: "결석" 만 그대로, 나머지(출석/지각/조퇴/보강) 는 모두 "출석".
 *
 * AttendanceStatusChip · 그리드 chip 렌더 시점에 호출.
 */
export function effectiveAttendanceStatus(
  status: AttendanceStatus,
  branch: string | null | undefined,
): AttendanceStatus {
  if (isStrictAttendanceBranch(branch)) return status;
  return status === "결석" ? "결석" : "출석";
}
