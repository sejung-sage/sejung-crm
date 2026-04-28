import type { StudentDetail } from "@/types/database";

interface Props {
  detail: StudentDetail;
}

/**
 * 학생 상세 KPI 4블록.
 * 총 수강 횟수 · 출석률 · 결석 수 · 총 결제금액
 */
export function StudentKpiCards({ detail }: Props) {
  const { profile, attendances, enrollments } = detail;

  const absentCount = attendances.filter((a) => a.status === "결석").length;

  const attendanceRate =
    profile.attendance_rate == null
      ? "—"
      : `${Math.round(profile.attendance_rate * 100) / 100}%`;

  // enrollments.amount 는 회차당 금액. 강좌 마스터의 total_sessions 와 곱한 합이
  // 실제 결제 총액이다. classes 매칭 실패 또는 회차 정보 없음(NULL/0) 인 행은
  // 보수적으로 amount 단독을 합산.
  const totalPaidValue = enrollments.reduce((sum, e) => {
    const sessions = e.class?.total_sessions ?? null;
    if (sessions !== null && sessions > 0) {
      return sum + Math.round(e.amount * sessions);
    }
    return sum + e.amount;
  }, 0);
  const totalPaid = `${totalPaidValue.toLocaleString("ko-KR")}원`;

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
