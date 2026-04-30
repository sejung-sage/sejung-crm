import type { ClassDetail } from "@/types/database";

interface Props {
  detail: ClassDetail;
}

/**
 * 강좌 상세 KPI 4블록.
 *
 * 학생 상세의 `student-kpi-cards.tsx` 톤·구조를 그대로 미러.
 *  1) 수강생 수
 *  2) 평균 출석률 (출석 + 보강 + 지각) / total. 보강은 출석 인정.
 *  3) 누적 결석
 *  4) 누적 보강
 */
export function ClassKpiCards({ detail }: Props) {
  const { students, attendances } = detail;

  const studentCount = students.length;

  // 출결 5종 카운트는 students 의 누적값을 sum 하는 게 가장 안전 (loader 가 이미 집계).
  let attended = 0;
  let absent = 0;
  let late = 0;
  let makeup = 0;
  let total = 0;
  for (const s of students) {
    attended += s.attended_count;
    absent += s.absent_count;
    late += s.late_count;
    makeup += s.makeup_count;
    total += s.total_count;
  }

  // students 가 0 이거나 attendances 매칭이 안 된 경우(자체 등록 강좌 등)
  // 학생 카운트만으로는 0 일 수 있어, attendances 행 수도 같이 검증.
  if (total === 0 && attendances.length > 0) {
    // 학생 메타가 누락된 출결 행이 있는 비정상 케이스.
    // attendances 자체에서 다시 집계 (안전망).
    for (const a of attendances) {
      total += 1;
      switch (a.status) {
        case "출석":
          attended += 1;
          break;
        case "결석":
          absent += 1;
          break;
        case "지각":
          late += 1;
          break;
        case "보강":
          makeup += 1;
          break;
      }
    }
  }

  // 평균 출석률 = (출석 + 보강 + 지각) / total. 0 이면 "—".
  const attendanceRate =
    total === 0
      ? "—"
      : `${Math.round(((attended + makeup + late) / total) * 1000) / 10}%`;

  return (
    <section
      aria-label="강좌 주요 지표"
      className="grid grid-cols-2 gap-3 md:grid-cols-4"
    >
      <KpiCard label="수강생 수" value={`${studentCount}명`} />
      <KpiCard label="평균 출석률" value={attendanceRate} />
      <KpiCard label="누적 결석" value={`${absent}회`} />
      <KpiCard label="누적 보강" value={`${makeup}회`} />
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
