import type { SeminarStatus } from "@/lib/seminars/dev-seed";
import { seminarStatusLabel } from "@/lib/seminars/dev-seed";

/**
 * 설명회 상태 칩.
 * 흑백 미니멀 톤 — 상태별로 회색/녹색/회색/적색 절제된 톤만.
 */
export function SeminarStatusBadge({ status }: { status: SeminarStatus }) {
  const tone = TONE[status];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium"
      style={tone}
    >
      {seminarStatusLabel(status)}
    </span>
  );
}

const TONE: Record<SeminarStatus, { backgroundColor: string; color: string }> =
  {
    open: {
      backgroundColor: "var(--success-bg)",
      color: "var(--success)",
    },
    closed: {
      backgroundColor: "var(--bg-muted)",
      color: "var(--text-muted)",
    },
    ended: {
      backgroundColor: "var(--bg-muted)",
      color: "var(--text-muted)",
    },
    cancelled: {
      backgroundColor: "var(--danger-bg)",
      color: "var(--danger)",
    },
  };
