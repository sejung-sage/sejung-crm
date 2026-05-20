import type { ClassDetail } from "@/types/database";

interface Props {
  detail: ClassDetail;
}

/**
 * 강좌 상세 KPI 3블록.
 *
 * 0063 — 평균 출석률(%) 폐기. 분원·정의 차이로 운영 신뢰도 부족.
 * raw 카운트(결석·보강)만으로도 강좌 운영 시야 충분.
 *
 *  1) 수강생 수
 *  2) 누적 결석 (raw event count)
 *  3) 누적 보강 (raw event count)
 */
export function ClassKpiCards({ detail }: Props) {
  const { students, attendances } = detail;

  const studentCount = students.length;

  // 출결 5종 카운트는 students 의 누적값을 sum 하는 게 가장 안전 (loader 가 이미 집계).
  let absent = 0;
  let makeup = 0;
  let total = 0;
  for (const s of students) {
    absent += s.absent_count;
    makeup += s.makeup_count;
    total += s.total_count;
  }

  // students 가 0 이거나 attendances 매칭이 안 된 경우(자체 등록 강좌 등)
  // 학생 카운트만으로는 0 일 수 있어, attendances 행 수도 같이 검증.
  if (total === 0 && attendances.length > 0) {
    for (const a of attendances) {
      total += 1;
      if (a.status === "결석") absent += 1;
      else if (a.status === "보강") makeup += 1;
    }
  }

  return (
    <section
      aria-label="강좌 주요 지표"
      className="grid grid-cols-3 gap-3"
    >
      <KpiCard label="수강생 수" value={`${studentCount}명`} />
      <KpiCard label="누적 결석" value={`${absent}회`} />
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
