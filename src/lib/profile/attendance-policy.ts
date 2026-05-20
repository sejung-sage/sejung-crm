/**
 * 분원별 출석 정책 (단일 소스).
 *
 * 운영 정책 (2026-05-20 갱신):
 *   "방배" 분원은 raw status (출석/지각/조퇴/보강) 를 그대로 그리드 chip 으로 노출.
 *   그 외 분원(대치/송도/반포): 모든 status 를 "출석" 으로 매핑해서 chip 렌더.
 *
 *   결석은 0066 에서 폐기 — 학원 운영상 결석=환불 처리이므로 결석 chip 도
 *   별도로 노출하지 않는다 (혹시 raw='결석' row 가 남아 있어도 비-방배에서는
 *   '출석' chip 으로 흡수, 방배도 5종 raw 에서 결석은 제거된 상태).
 */

import type { AttendanceStatus } from "@/types/database";

/**
 * 5종 status 를 raw 그대로 노출하는 분원 화이트리스트.
 * 현재는 "방배" 1곳. 추후 정책 변경 시 본 set 만 수정 → 모든 호출부에 일괄 반영.
 */
const STRICT_ATTENDANCE_BRANCHES: ReadonlySet<string> = new Set(["방배"]);

/** 분원이 raw 출석을 그대로 운영하는지 여부. branch 가 빈 값이면 false. */
export function isStrictAttendanceBranch(
  branch: string | null | undefined,
): boolean {
  if (!branch) return false;
  return STRICT_ATTENDANCE_BRANCHES.has(branch);
}

/**
 * 표시용 출석 status 정규화.
 *
 * 방배:    raw status 그대로 (결석 row 도 그대로 결석 — 다만 0066 이후 결석은
 *          격자에서 별도 카운트 안 함).
 * 그 외:   모든 status 를 "출석" 으로 매핑. 결석 chip 자체가 사라짐.
 *
 * AttendanceStatusChip · 그리드 chip 렌더 시점에 호출.
 */
export function effectiveAttendanceStatus(
  status: AttendanceStatus,
  branch: string | null | undefined,
): AttendanceStatus {
  if (isStrictAttendanceBranch(branch)) return status;
  return "출석";
}
