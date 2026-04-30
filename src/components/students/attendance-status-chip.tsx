import type { AttendanceStatus } from "@/types/database";

/**
 * 출결 상태 칩 (5종 — 출/지/결/조/보).
 *
 * 학생 상세의 강좌×일자 격자, 강좌 상세의 학생×일자 격자에서 공유.
 * 두 격자의 색상·크기·라벨이 1픽셀이라도 어긋나지 않도록 단일 소스.
 *
 * 보강(보)은 출석률 계산상 출석으로 인정되며, 시각적으로도 출(emerald)
 * 과 구분되는 sky 톤을 사용한다.
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

export function AttendanceStatusChip({ status }: { status: AttendanceStatus }) {
  const s = STATUS_CHIP[status];
  return (
    <span
      aria-label={status}
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
