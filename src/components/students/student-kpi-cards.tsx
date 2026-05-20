import type { StudentDetail } from "@/types/database";

interface Props {
  detail: StudentDetail;
}

/**
 * 학생 상세 KPI 2블록.
 * 총 수강 횟수 · 총 결제금액
 *
 * 0063 — 출석률(%) 폐기. 0066 — 결석 수 폐기 (결석 = 환불 처리되므로 운영 무의미).
 *
 * 총 결제금액 = sum( enrollment.amount × 실제 들은 횟수 ).
 *   - 들은 횟수 = 그 enrollment 의 aca_class_id 와 매칭되는 attendance row 수.
 *   - 강좌의 정해진 total_sessions (예: 8회) 가 아니라 실제 수강한 횟수 기준.
 *   - "8회치가 정해져있어도 24회 들으면 24회 × 회당 금액" 시나리오 반영
 *     (수강 연장·추가 회차 결제 등).
 *   - 매칭 attendance 0건이면 0원 (수강 안 함 = 결제 0).
 *   - aca_class_id 가 NULL 인 enrollment 는 매칭 불가 → 보수적으로 amount 단독.
 */
export function StudentKpiCards({ detail }: Props) {
  const { profile, enrollments, attendances } = detail;

  // enrollment 의 aca_class_id 별 attendance count 인덱스.
  const attendanceCountByClass = new Map<string, number>();
  for (const a of attendances) {
    if (!a.aca_class_id) continue;
    attendanceCountByClass.set(
      a.aca_class_id,
      (attendanceCountByClass.get(a.aca_class_id) ?? 0) + 1,
    );
  }

  const totalPaidValue = enrollments.reduce((sum, e) => {
    if (!e.aca_class_id) return sum + e.amount; // 매칭 불가 시 보수적.
    const attendedCount = attendanceCountByClass.get(e.aca_class_id) ?? 0;
    if (attendedCount === 0) return sum; // 수강 안 함 = 결제 반영 안 함.
    return sum + Math.round(e.amount * attendedCount);
  }, 0);
  const totalPaid = `${totalPaidValue.toLocaleString("ko-KR")}원`;

  return (
    <section
      aria-label="학생 주요 지표"
      className="grid grid-cols-2 gap-3"
    >
      <KpiCard label="총 수강 횟수" value={`${profile.enrollment_count}건`} />
      <KpiCard label="총 결제금액" value={totalPaid} />
    </section>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-bg-card px-5 py-4">
      <p className="text-[12px] font-medium text-[color:var(--text-muted)]">
        {label}
      </p>
      <p className="mt-1 text-[24px] font-semibold text-[color:var(--text)] tabular-nums">
        {value}
      </p>
    </div>
  );
}
