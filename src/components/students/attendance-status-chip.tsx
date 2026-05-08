import type { AttendanceStatus } from "@/types/database";
import { effectiveAttendanceStatus } from "@/lib/profile/attendance-policy";

/**
 * 출결 상태 칩 (5종 — 출/지/결/조/보).
 *
 * 학생 상세의 강좌×일자 격자, 강좌 상세의 학생×일자 격자에서 공유.
 * 두 격자의 색상·크기·라벨이 1픽셀이라도 어긋나지 않도록 단일 소스.
 *
 * 분원별 노출 정책 (`branch` prop 기준):
 *   - 방배          : raw 5종 그대로 (출/지/결/조/보)
 *   - 그 외 / 미지정 : 결석만 결(rose), 나머지 모두 출(emerald) 로 정규화
 *                       (이행 정책 — `effectiveAttendanceStatus` 단일 소스)
 *
 * 보강(보)은 5종 모드에서 sky 톤으로 출과 구분 — 출석률 계산상은 출석 인정.
 */

interface ChipStyle {
  label: string;
  cls: string;
}

const STATUS_CHIP: Record<AttendanceStatus, ChipStyle> = {
  출석: {
    label: "출",
    cls: "bg-emerald-50 text-emerald-700 border-emerald-100",
  },
  보강: {
    label: "보",
    cls: "bg-sky-50 text-sky-700 border-sky-100",
  },
  지각: {
    label: "지",
    cls: "bg-amber-50 text-amber-700 border-amber-100",
  },
  결석: {
    label: "결",
    cls: "bg-rose-50 text-rose-700 border-rose-100",
  },
  조퇴: {
    label: "조",
    cls: "bg-slate-100 text-slate-600 border-slate-200",
  },
};

export function AttendanceStatusChip({
  status,
  branch,
}: {
  status: AttendanceStatus;
  /**
   * 학생/강좌 분원. "방배" 면 raw 5종 그대로 노출, 그 외/미지정이면 결석 외
   * status 를 모두 "출석" chip 으로 정규화한다.
   */
  branch?: string | null;
}) {
  const effective = effectiveAttendanceStatus(status, branch);
  const s = STATUS_CHIP[effective];
  return (
    <span
      aria-label={effective}
      title={status !== effective ? `원본: ${status}` : undefined}
      className={`
        inline-flex items-center justify-center
        w-7 h-6 rounded border
        text-[12px] font-medium tabular-nums
        ${s.cls}
      `}
    >
      <span aria-hidden>{s.label}</span>
    </span>
  );
}
