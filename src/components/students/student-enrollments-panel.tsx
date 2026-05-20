import type { EnrollmentWithClass } from "@/types/database";
import { parseCourseName } from "@/lib/profile/parse-course-name";

interface Props {
  enrollments: EnrollmentWithClass[];
}

/**
 * 학생 상세 · 수강 이력 패널.
 *
 * enrollments.amount 는 회차당 금액. 강좌 마스터(class)가 매칭되면
 * 회차 수와 곱해 총액을 메인으로 노출, 회당 단가는 서브 라인에 표기.
 *
 * 선생님·과목 표시 우선순위:
 *   1) enrollments.teacher_name / subject (ETL 가 항상 NULL — placeholder)
 *   2) classes 마스터 (aca_class_id join)
 *   3) course_name 자유형 파싱 (`parseCourseName`) — 강좌 매칭 실패 시 noise 감축
 *   4) "—"
 *
 * (3) 은 ETL 데이터 정합성과 별개로 화면 즉시 개선용 fallback. 정확도는
 * `parse-course-name.ts` 의 보수적 패턴에 의존 — 모호하면 null 반환 → "—".
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
            <Th className="w-32">결제일</Th>
          </tr>
        </thead>
        <tbody>
          {enrollments.map((e) => {
            const parsed = parseCourseName(e.course_name);
            const teacher =
              e.teacher_name ?? e.class?.teacher_name ?? parsed.teacher ?? "—";
            const subject =
              e.subject ??
              e.class?.subject ??
              e.class?.subject_raw ??
              parsed.subject ??
              "—";
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
                  <AmountCell amount={e.amount} />
                </Td>
                <Td>
                  <PaymentStatusCell paidAt={e.paid_at} />
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
 * 결제 상태 셀.
 *  - paid_at 있음 → "결완" 칩 + 결제일
 *  - paid_at 없음 → "—" (미납 태그 미노출 — 사용자 요청 2026-05-20)
 */
function PaymentStatusCell({ paidAt }: { paidAt: string | null }) {
  if (!paidAt) {
    return (
      <span className="text-[color:var(--text-dim)]" aria-label="결제일 없음">
        —
      </span>
    );
  }
  // ISO 또는 YYYY-MM-DD 모두 앞 10자만 잘라 노출.
  const dateStr = paidAt.length >= 10 ? paidAt.slice(0, 10) : paidAt;
  return (
    <div className="flex flex-col items-start gap-0.5">
      <span
        className="
          inline-flex items-center px-2 py-0.5 rounded-full
          text-[12px] font-medium
          bg-[color:var(--bg-muted)] text-[color:var(--text)]
          border border-[color:var(--border)]
        "
      >
        결완
      </span>
      <span className="text-[12px] text-[color:var(--text-muted)] tabular-nums">
        {dateStr}
      </span>
    </div>
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
