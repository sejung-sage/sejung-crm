import type { EnrollmentWithClass } from "@/types/database";
import { parseCourseName } from "@/lib/profile/parse-course-name";
import { parseCourseProgress } from "@/lib/profile/course-progress";

interface Props {
  enrollments: EnrollmentWithClass[];
}

/**
 * 학생 상세 · 수강 이력 패널.
 *
 * 행 정렬: 진행 중 위 → end_date 최신 순.
 *   진행 중 판정: end_date IS NULL || end_date(YYYY-MM-DD 앞 10자) >= today.
 *   '2050-01-01' sentinel 도 자연스럽게 진행 중으로 잡힘.
 *
 * 선생님·과목 표시 우선순위:
 *   1) enrollments.teacher_name / subject (ETL 가 항상 NULL — placeholder)
 *   2) classes 마스터 (aca_class_id join)
 *   3) course_name 자유형 파싱 (`parseCourseName`) — 강좌 매칭 실패 시 noise 감축
 *   4) "—"
 */

export function StudentEnrollmentsPanel({ enrollments }: Props) {
  if (enrollments.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-bg-card py-16 text-center">
        <p className="text-[15px] text-[color:var(--text-muted)]">
          수강 이력이 없습니다.
        </p>
      </div>
    );
  }

  // 진행 중 위로 → end_date 내림차순.
  // 진행 상태는 course_name prefix enum 파싱 — 날짜 sentinel('2050-01-01') 이슈 회피.
  const sorted = [...enrollments].sort((a, b) => {
    const ao = parseCourseProgress(a.course_name) === "ongoing";
    const bo = parseCourseProgress(b.course_name) === "ongoing";
    if (ao !== bo) return ao ? -1 : 1;
    const ad = a.end_date ?? "";
    const bd = b.end_date ?? "";
    return bd.localeCompare(ad);
  });

  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-bg-card overflow-hidden">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[color:var(--border)] bg-[color:var(--bg-muted)]">
            <Th>수업내용</Th>
            <Th className="w-32">선생님</Th>
            <Th className="w-24 text-center">과목</Th>
            <Th className="w-56">기간</Th>
            <Th className="w-44 text-right">금액</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((e) => {
            const parsed = parseCourseName(e.course_name);
            const teacher =
              e.teacher_name ?? e.class?.teacher_name ?? parsed.teacher ?? "—";
            const subject =
              e.subject ??
              e.class?.subject ??
              e.class?.subject_raw ??
              parsed.subject ??
              "—";
            const ongoing = parseCourseProgress(e.course_name) === "ongoing";
            return (
              <tr
                key={e.id}
                className="border-b border-[color:var(--border)] last:border-b-0"
              >
                <Td className="text-[color:var(--text)]">
                  <div className="flex items-center gap-2">
                    <ProgressBadge ongoing={ongoing} />
                    <span>{e.course_name}</span>
                  </div>
                </Td>
                <Td className="text-[color:var(--text-muted)]">{teacher}</Td>
                <Td className="text-center text-[color:var(--text-muted)]">
                  {subject}
                </Td>
                <Td className="text-[color:var(--text-muted)] tabular-nums">
                  {formatPeriod(e.start_date, e.end_date)}
                </Td>
                <Td className="text-right tabular-nums">
                  <AmountCell amount={e.amount} />
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 강좌 진행 상태 배지 — 출석 탭의 ProgressBadge 와 동일 톤.
 * 운영자가 두 패널 사이 시각 일관성으로 같은 의미라 즉시 인식.
 */
function ProgressBadge({ ongoing }: { ongoing: boolean }) {
  if (ongoing) {
    return (
      <span
        className="
          inline-flex shrink-0 items-center px-2 py-0.5 rounded-full
          text-[11px] font-medium
          bg-[color:var(--action)] text-[color:var(--action-text)]
        "
      >
        진행 중
      </span>
    );
  }
  return (
    <span
      className="
        inline-flex shrink-0 items-center px-2 py-0.5 rounded-full
        text-[11px] font-medium
        bg-[color:var(--bg-muted)] text-[color:var(--text-muted)]
        border border-[color:var(--border)]
      "
    >
      완료
    </span>
  );
}

/**
 * 금액 셀 — 회당 금액 단독 표시.
 *
 * 옛 버전: 총액(회당 × 정해진 회차) + "회당 X원 × N회" 부가표시.
 * 변경: 정해진 회차가 실제 수강 회차와 무관할 수 있어 (연장·추가 등) "총액"
 * 표기가 오해를 일으킴 → 회당 금액만 노출. 실제 결제 합계는 학생 KPI 의
 * "총 결제금액" 카드(들은 회차 × 회당) 로 확인.
 */
function AmountCell({ amount }: { amount: number }) {
  return (
    <span className="text-[color:var(--text)]">
      {amount.toLocaleString("ko-KR")}원/회
    </span>
  );
}

function formatPeriod(start: string | null, end: string | null): string {
  if (start && end) return `${start} ~ ${end}`;
  if (start) return start;
  if (end) return end;
  return "—";
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
