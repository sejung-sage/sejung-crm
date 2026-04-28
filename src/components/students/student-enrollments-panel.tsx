import type { EnrollmentRow } from "@/types/database";

interface Props {
  enrollments: EnrollmentRow[];
}

/**
 * 학생 상세 · 수강 이력 패널.
 */
export function StudentEnrollmentsPanel({ enrollments }: Props) {
  if (enrollments.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-white py-16 text-center">
        <p className="text-[15px] text-[color:var(--text-muted)]">
          수강 이력이 없습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-white overflow-hidden">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[color:var(--border)] bg-[color:var(--bg-muted)]">
            <Th>수업내용</Th>
            <Th className="w-32">선생님</Th>
            <Th className="w-24 text-center">과목</Th>
            <Th className="w-56">기간</Th>
            <Th className="w-32 text-right">금액</Th>
            <Th className="w-32">결제일</Th>
          </tr>
        </thead>
        <tbody>
          {enrollments.map((e) => (
            <tr
              key={e.id}
              className="border-b border-[color:var(--border)] last:border-b-0"
            >
              <Td className="text-[color:var(--text)]">{e.course_name}</Td>
              <Td className="text-[color:var(--text-muted)]">
                {e.teacher_name ?? "—"}
              </Td>
              <Td className="text-center text-[color:var(--text-muted)]">
                {e.subject ?? "—"}
              </Td>
              <Td className="text-[color:var(--text-muted)] tabular-nums">
                {formatPeriod(e.start_date, e.end_date)}
              </Td>
              <Td className="text-right text-[color:var(--text)] tabular-nums">
                {e.amount.toLocaleString("ko-KR")}원
              </Td>
              <Td className="text-[color:var(--text-muted)] tabular-nums">
                {e.paid_at ?? "—"}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
