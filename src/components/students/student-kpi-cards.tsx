import type { StudentDetail } from "@/types/database";

interface Props {
  detail: StudentDetail;
}

/**
 * 학생 상세 KPI 4블록.
 * 총 수강 횟수 · 출석률 · 결석 수 · 총 결제금액
 */
export function StudentKpiCards({ detail }: Props) {
  const { profile, attendances } = detail;

  const absentCount = attendances.filter((a) => a.status === "결석").length;

  const attendanceRate =
    profile.attendance_rate == null
      ? "—"
      : `${Math.round(profile.attendance_rate * 100) / 100}%`;

  const totalPaid = `${profile.total_paid.toLocaleString("ko-KR")}원`;

  return (
    <section
      aria-label="학생 주요 지표"
      className="grid grid-cols-2 gap-3 md:grid-cols-4"
    >
      <KpiCard label="총 수강 횟수" value={`${profile.enrollment_count}건`} />
      <KpiCard label="출석률" value={attendanceRate} />
      <KpiCard label="결석 수" value={`${absentCount}회`} />
      <KpiCard label="총 결제금액" value={totalPaid} />
    </section>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-white px-5 py-4">
      <p className="text-[12px] font-medium text-[color:var(--text-muted)]">
        {label}
      </p>
      <p className="mt-1 text-[24px] font-semibold text-[color:var(--text)] tabular-nums">
        {value}
      </p>
    </div>
  );
}
