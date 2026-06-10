import type { ClassDetail } from "@/types/database";
import type { ClassSignupParentRow } from "@/lib/seminars/get-class-signup-page";

interface Props {
  detail: ClassDetail;
  /**
   * 설명회면 CRM 공개 신청생(signed) 목록. 넘어오면 일반 KPI 2블록 대신
   * "총 수강생 수" 단일 블록(아카 수강생 ∪ CRM 신청생)으로 분기한다.
   * 일반 강좌면 null.
   */
  seminarSignups?: ClassSignupParentRow[] | null;
}

/**
 * 강좌 상세 KPI 블록.
 *
 * 0063 — 평균 출석률(%) 폐기. 0066 — 누적 결석 폐기 (결석=환불, 운영 무의미).
 *
 * 일반 강좌(2블록):
 *  1) 수강생 수
 *  2) 누적 보강 (raw event count)
 *
 * 설명회(1블록): 아카 수강생과 CRM 신청생이 섞이고 출결·보강이 없어
 *  수강생 수/누적 보강이 무의미하므로, student_id 기준 합집합인
 *  "총 수강생 수" 하나로 합친다.
 */
export function ClassKpiCards({ detail, seminarSignups = null }: Props) {
  const { students, attendances } = detail;

  // 설명회: 아카 수강생 + CRM 신청생을 student_id 기준 합집합으로 센다.
  // 두 명단에 모두 있는 학생(아카에도 등록·신청함)은 1명으로만 카운트.
  if (seminarSignups) {
    const ids = new Set(students.map((s) => s.id));
    for (const p of seminarSignups) ids.add(p.student_id);
    return (
      <section aria-label="설명회 주요 지표" className="grid grid-cols-1 gap-3">
        <KpiCard label="총 수강생 수" value={`${ids.size}명`} />
      </section>
    );
  }

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
