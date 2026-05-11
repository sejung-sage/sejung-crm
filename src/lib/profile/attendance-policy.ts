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
 *
 * 방배:    (출석 + 지각 + 보강) / 전체 attendance row
 *           - 분모는 attendance row 수 (5종 detail 정확 추적 정책)
 *           - 전체 row 가 0 이면 null
 *
 * 그 외:
 *   - `expectedTotal` 가 주어지면: GREATEST(expectedTotal - 결석, 0) / expectedTotal
 *      → "결석이 아닌 모든 수강은 출석" 정책 (DB student_profiles view 0030 과 동일).
 *      enrollment_count 같은 "있어야 할 row 수" 를 분모로 잡아 attendance row 누락
 *      이슈를 회피.
 *   - `expectedTotal` 미지정시 (기존 호출부 호환): (전체 - 결석) / 전체 attendance row
 *      → 강좌 KPI 등 attendance row 기반 의미가 적합한 곳에서 사용.
 *      전체 row 가 0 이면 null.
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
  /**
   * 비-방배 분원에서 출석률 분모로 사용할 "있어야 할 수강·세션 수"
   * (예: 학생의 enrollment_count). 미지정시 attendance row 기반.
   */
  expectedTotal?: number,
): number | null {
  if (isStrictAttendanceBranch(branch)) {
    // 방배: attendance row 기반 5종 룰 유지.
    const total =
      counts.attended +
      counts.late +
      counts.absent +
      counts.earlyLeave +
      counts.makeup;
    if (total === 0) return null;
    const numerator = counts.attended + counts.late + counts.makeup;
    return Math.round((numerator / total) * 1000) / 10;
  }

  // 비-방배 — expectedTotal 우선, 없으면 attendance row 기반.
  if (typeof expectedTotal === "number" && expectedTotal > 0) {
    const numerator = Math.max(0, expectedTotal - counts.absent);
    return Math.round((numerator / expectedTotal) * 1000) / 10;
  }

  const total =
    counts.attended +
    counts.late +
    counts.absent +
    counts.earlyLeave +
    counts.makeup;
  if (total === 0) return null;
  const numerator = total - counts.absent;
  return Math.round((numerator / total) * 1000) / 10;
}
