import type { ClassDetail } from "@/types/database";

interface Props {
  detail: ClassDetail;
}

/**
 * 강좌 상세 KPI 2블록.
 *
 * 0063 — 평균 출석률(%) 폐기. 0066 — 누적 결석 폐기 (결석=환불, 운영 무의미).
 *
 *  1) 수강생 수
 *  2) 누적 보강 (raw event count)
 */
export function ClassKpiCards({ detail }: Props) {
  const { students, attendances } = detail;

  const studentCount = students.length;

  // makeup 카운트는 students 의 누적값을 sum (loader 가 이미 집계).
  let makeup = 0;
  let total = 0;
  for (const s of students) {
    makeup += s.makeup_count;
    total += s.total_count;
  }

  // students 매핑이 안 된 비정상 케이스 안전망 — attendances 자체에서 보강 집계.
  if (total === 0 && attendances.length > 0) {
    for (const a of attendances) {
      total += 1;
      if (a.status === "보강") makeup += 1;
    }
  }

  return (
    <section
      aria-label="강좌 주요 지표"
      className="grid grid-cols-2 gap-3"
    >
      <KpiCard label="수강생 수" value={`${studentCount}명`} />
      <KpiCard label="누적 보강" value={`${makeup}회`} />
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
