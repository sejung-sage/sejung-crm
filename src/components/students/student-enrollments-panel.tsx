import type { EnrollmentWithClass } from "@/types/database";
import { parseCourseName } from "@/lib/profile/parse-course-name";
import {
  isCourseOngoing,
  isSeminarCourse,
} from "@/lib/profile/course-progress";

/**
 * enrollment 의 "진행 중" 여부 — 설명회 아님 AND 종강 접두 아님 AND end_date 미래/없음.
 * 단일 정의 isCourseOngoing 사용(목록 active_enrollment_count·출석 탭과 동일 규칙).
 */
function isOngoing(e: EnrollmentWithClass): boolean {
  return isCourseOngoing({
    courseName: e.course_name,
    subject: e.subject ?? e.class?.subject,
    endDate: e.end_date,
  });
}

interface Props {
  enrollments: EnrollmentWithClass[];
}

/**
 * 학생 상세 · 수강 이력 패널.
 *
 * 행 정렬: 진행 중 위 → end_date 최신 순.
 *   진행 중 판정(isCourseOngoing): 설명회 아님 AND 종강 접두((종)/(폐)) 아님
 *   AND end_date 미래/없음. sentinel('2050-01-01') 은 미래라 진행 중 유지.
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
  const sorted = [...enrollments].sort((a, b) => {
    const ao = isOngoing(a);
    const bo = isOngoing(b);
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
            const seminar = isSeminarCourse(
              e.subject ?? e.class?.subject,
              e.course_name,
            );
            const ongoing = isOngoing(e);
            return (
              <tr
                key={e.id}
                className="border-b border-[color:var(--border)] last:border-b-0"
              >
                <Td className="text-[color:var(--text)]">
                  <div className="flex items-center gap-2">
                    <ProgressBadge ongoing={ongoing} seminar={seminar} />
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
function ProgressBadge({
  ongoing,
  seminar = false,
}: {
  ongoing: boolean;
  seminar?: boolean;
}) {
  // 설명회는 진행 중/완료 대신 중립 '설명회' 배지(수업 아님).
  if (seminar) {
    return (
      <span
        className="
          inline-flex shrink-0 items-center px-2 py-0.5 rounded-full
          text-[11px] font-medium
          bg-[color:var(--bg-muted)] text-[color:var(--text-dim)]
          border border-[color:var(--border)]
        "
      >
        설명회
      </span>
    );
  }
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
