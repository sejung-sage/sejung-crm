import type { SendDashboardRow } from "@/lib/dashboard/send-dashboard";

/**
 * 발송 대시보드 요약 카드 (서버 컴포넌트, 상호작용 없음).
 *
 * 표시 중인 행 전체를 합산해 총 발송 건수 · 총 금액 · 유형별 건수를 보여준다.
 * student-kpi-cards 의 KpiCard 관례(라벨 12px muted + 값 큰 semibold)를 따른다.
 */
export function DashboardSummary({ rows }: { rows: SendDashboardRow[] }) {
  const totals = rows.reduce(
    (acc, r) => {
      acc.msgCount += r.msgCount;
      acc.totalCost += r.totalCost;
      acc.smsCount += r.smsCount;
      acc.lmsCount += r.lmsCount;
      acc.alimtalkCount += r.alimtalkCount;
      return acc;
    },
    { msgCount: 0, totalCost: 0, smsCount: 0, lmsCount: 0, alimtalkCount: 0 },
  );

  return (
    <section
      aria-label="발송 요약"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3"
    >
      <KpiCard
        label="총 발송 건수"
        value={`${totals.msgCount.toLocaleString("ko-KR")}건`}
      />
      <KpiCard
        label="총 금액"
        value={`${totals.totalCost.toLocaleString("ko-KR")}원`}
      />
      <KpiCard
        label="유형별 건수"
        value={
          <span className="text-[16px]">
            SMS {totals.smsCount.toLocaleString("ko-KR")} · LMS{" "}
            {totals.lmsCount.toLocaleString("ko-KR")} · 알림톡{" "}
            {totals.alimtalkCount.toLocaleString("ko-KR")}
          </span>
        }
      />
    </section>
  );
}

function KpiCard({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
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
