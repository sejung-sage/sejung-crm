import type { AttendanceRow, AttendanceStatus } from "@/types/database";

interface Props {
  attendances: AttendanceRow[];
}

const STATUS_ORDER: AttendanceStatus[] = ["출석", "지각", "결석", "조퇴"];

/**
 * 학생 상세 · 출석 패널.
 * 상단: 최근 3개월 월별 요약 (현재 기준 2026-04 포함).
 * 하단: 최대 50개 출석 기록 리스트.
 */
export function StudentAttendancesPanel({ attendances }: Props) {
  if (attendances.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-white py-16 text-center">
        <p className="text-[15px] text-[color:var(--text-muted)]">
          출석 기록이 없습니다.
        </p>
      </div>
    );
  }

  const months = recentThreeMonths();
  const summaries = months.map((m) => buildMonthSummary(attendances, m));
  const rows = attendances.slice(0, 50);

  return (
    <div className="space-y-6">
      <section aria-label="최근 3개월 출석 요약">
        <p className="mb-2 text-[13px] font-medium text-[color:var(--text-muted)]">
          최근 3개월 요약
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {summaries.map((s) => (
            <div
              key={s.ym}
              className="rounded-xl border border-[color:var(--border)] bg-white px-4 py-3"
            >
              <p className="text-[13px] font-medium text-[color:var(--text)]">
                {formatYm(s.ym)}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-[color:var(--text-muted)] tabular-nums">
                {STATUS_ORDER.map((k) => (
                  <span key={k}>
                    {k} <span className="text-[color:var(--text)]">{s.counts[k]}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section aria-label="출석 상세 목록">
        <div className="rounded-xl border border-[color:var(--border)] bg-white overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[color:var(--border)] bg-[color:var(--bg-muted)]">
                <Th className="w-40">날짜</Th>
                <Th className="w-24">상태</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr
                  key={a.id}
                  className="border-b border-[color:var(--border)] last:border-b-0"
                >
                  <Td className="text-[color:var(--text)] tabular-nums">
                    {a.attended_at}
                  </Td>
                  <Td>
                    <AttendanceStatusBadge status={a.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {attendances.length > 50 && (
          <p className="mt-2 text-[13px] text-[color:var(--text-muted)]">
            최근 50건만 표시합니다. (전체 {attendances.length}건)
          </p>
        )}
      </section>
    </div>
  );
}

function AttendanceStatusBadge({ status }: { status: AttendanceStatus }) {
  switch (status) {
    case "출석":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[13px] font-medium bg-[color:var(--action)] text-[color:var(--action-text)]">
          출석
        </span>
      );
    case "지각":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[13px] font-medium bg-[color:var(--bg-muted)] text-[color:var(--text-muted)]">
          지각
        </span>
      );
    case "결석":
      return (
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-[13px] font-medium border"
          style={{
            borderColor: "var(--danger)",
            color: "var(--danger)",
            backgroundColor: "var(--bg)",
          }}
        >
          결석
        </span>
      );
    case "조퇴":
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[13px] font-medium bg-[color:var(--bg-muted)] text-[color:var(--text-muted)]">
          조퇴
        </span>
      );
  }
}

interface MonthSummary {
  ym: string; // YYYY-MM
  counts: Record<AttendanceStatus, number>;
}

function buildMonthSummary(
  attendances: AttendanceRow[],
  ym: string,
): MonthSummary {
  const counts: Record<AttendanceStatus, number> = {
    출석: 0,
    지각: 0,
    결석: 0,
    조퇴: 0,
  };
  for (const a of attendances) {
    if (a.attended_at && a.attended_at.slice(0, 7) === ym) {
      counts[a.status] += 1;
    }
  }
  return { ym, counts };
}

function recentThreeMonths(): string[] {
  const now = new Date();
  const result: string[] = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    result.push(`${y}-${m}`);
  }
  return result; // 최신 → 오래된 순
}

function formatYm(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y}년 ${Number(m)}월`;
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`
        px-4 py-3 text-left text-[13px] font-medium
        text-[color:var(--text-muted)] uppercase tracking-wide
        ${className}
      `}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-3 text-[15px] ${className}`}>{children}</td>;
}
