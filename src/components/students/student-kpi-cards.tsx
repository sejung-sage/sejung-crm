import type { StudentDetail } from "@/types/database";

interface Props {
  detail: StudentDetail;
}

/**
 * 학생 상세 KPI 3블록.
 * 총 수강 횟수 · 결석 수 · 총 결제금액
 *
 * 0063 — 출석률(%) 지표 폐기. ETL 매핑 갭으로 신뢰도 부족 (분원·정의 차이).
 * 결석 수 + 출석 격자만으로 운영 시야 충분하다는 판단.
 *
 * 결석 수는 student_profiles.absent_count (enrollment 매칭 결석) 사용 —
 * detail.attendances 로 후집계하면 등록 외 강좌 잔재가 섞일 수 있어 격자와
 * 불일치하던 회귀를 차단.
 */
export function StudentKpiCards({ detail }: Props) {
  const { profile, enrollments } = detail;

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
      className="grid grid-cols-3 gap-3"
    >
      <KpiCard label="총 수강 횟수" value={`${profile.enrollment_count}건`} />
      <KpiCard label="결석 수" value={`${profile.absent_count}회`} />
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
