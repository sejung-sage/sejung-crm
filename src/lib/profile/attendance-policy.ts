/**
 * 분원별 출석 정책 (단일 소스).
 *
 * 운영 정책 (사용자 확정 · 2026-05-08):
 *   "방배" 분원은 5종 status (출석/지각/결석/조퇴/보강) 를 그대로 운영하며
 *   출석률 / 그리드 chip / 카운트 모두 5종 그대로 노출한다.
 *
 *   그 외 분원(대치/송도/반포) 은 결석 외 모든 status 를 출석으로 간주.
 *   - 출석률  : (전체 - 결석) / 전체
 *   - 그리드  : 결석만 빨강(결) chip, 나머지는 모두 녹색(출) chip
 *   - 누적 결석/보강 카드는 raw event count 를 그대로 유지 (정보 가치 보존)
 *
 * DB 단 student_profiles.attendance_rate 는 0029 마이그레이션이 동일 정책을
 * SQL 로 적용한다 — 이 모듈은 앱 레이어에서 동일 룰을 미러.
 */

import type { AttendanceStatus } from "@/types/database";

/**
 * 5종 status 를 raw 그대로 노출하는 분원 화이트리스트.
 *
 * 현재는 "방배" 1곳. 추후 정책 변경 시 본 set 만 수정 → 모든 호출부에 일괄 반영.
 */
const STRICT_ATTENDANCE_BRANCHES: ReadonlySet<string> = new Set(["방배"]);

/** 분원이 5종 raw 출석을 그대로 운영하는지 여부. branch 가 빈 값이면 false. */
export function isStrictAttendanceBranch(branch: string | null | undefined): boolean {
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

/**
 * 카운트 객체에서 평균 출석률 계산 (분원 분기).
 *
 * 입력 카운트는 raw 5종 그대로 — 함수 내부에서 분원에 맞는 계산식 적용.
 * 전체가 0 이면 null (호출부가 "—" 로 표시).
 *
 * 방배:    (출석 + 지각 + 보강) / 전체
 * 그 외:   (전체 - 결석) / 전체  = (출석 + 지각 + 조퇴 + 보강) / 전체
 *
 * 반환: 0~100 범위의 number (소수점 한 자리 반올림). null = 데이터 없음.
 */
export interface AttendanceCounts {
  attended: number;
  late: number;
  absent: number;
  earlyLeave: number;
  makeup: number;
}

export function computeAttendanceRate(
  counts: AttendanceCounts,
  branch: string | null | undefined,
): number | null {
  const total =
    counts.attended +
    counts.late +
    counts.absent +
    counts.earlyLeave +
    counts.makeup;
  if (total === 0) return null;
  const numerator = isStrictAttendanceBranch(branch)
    ? counts.attended + counts.late + counts.makeup
    : total - counts.absent;
  return Math.round((numerator / total) * 1000) / 10;
}
