import type { EnrollmentWithClass } from "@/types/database";

interface Props {
  enrollments: EnrollmentWithClass[];
}

/**
 * 학생 상세 · 수강 이력 패널.
 *
 * enrollments.amount 는 회차당 금액. 강좌 마스터(class)가 매칭되면
 * 회차 수와 곱해 총액을 메인으로 노출, 회당 단가는 서브 라인에 표기.
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
            <Th className="w-44 text-right">금액</Th>
            <Th className="w-32">결제일</Th>
          </tr>
        </thead>
        <tbody>
          {enrollments.map((e) => {
            const teacher = e.teacher_name ?? e.class?.teacher_name ?? "—";
            const subject =
              e.subject ?? e.class?.subject ?? e.class?.subject_raw ?? "—";
            return (
              <tr
                key={e.id}
                className="border-b border-[color:var(--border)] last:border-b-0"
              >
                <Td className="text-[color:var(--text)]">{e.course_name}</Td>
                <Td className="text-[color:var(--text-muted)]">{teacher}</Td>
                <Td className="text-center text-[color:var(--text-muted)]">
                  {subject}
                </Td>
                <Td className="text-[color:var(--text-muted)] tabular-nums">
                  {formatPeriod(e.start_date, e.end_date)}
                </Td>
                <Td className="text-right tabular-nums">
                  <AmountCell
                    amount={e.amount}
                    sessions={e.class?.total_sessions ?? null}
                  />
                </Td>
                <Td className="text-[color:var(--text-muted)] tabular-nums">
                  {e.paid_at ?? "—"}
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
 * 금액 셀.
 * - 회차 정보 있음 → 메인: 총액(회당×회차), 서브: "회당 X원 × N회"
 * - 회차 정보 없음 → 메인: 회당 금액(amount) 단독
 */
function AmountCell({
  amount,
  sessions,
}: {
  amount: number;
  sessions: number | null;
}) {
  if (sessions !== null && sessions > 0) {
    const total = Math.round(amount * sessions);
    const sessionsLabel = formatSessions(sessions);
    return (
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-[color:var(--text)]">
          {total.toLocaleString("ko-KR")}원
        </span>
        <span className="text-[12px] text-[color:var(--text-muted)]">
          회당 {amount.toLocaleString("ko-KR")}원 × {sessionsLabel}회
        </span>
      </div>
    );
  }

  return (
    <span className="text-[color:var(--text)]">
      {amount.toLocaleString("ko-KR")}원
    </span>
  );
}

function formatSessions(sessions: number): string {
  // 청구회차는 decimal 원본이라 정수면 정수로, 소수면 한 자리만.
  if (Number.isInteger(sessions)) return String(sessions);
  return sessions.toFixed(1);
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
