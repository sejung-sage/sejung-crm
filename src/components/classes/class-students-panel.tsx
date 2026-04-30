import Link from "next/link";
import type { ClassStudentRow } from "@/types/database";
import { maskPhone } from "@/lib/phone";

interface Props {
  students: ClassStudentRow[];
}

/**
 * 강좌 상세 · 수강생 명단 테이블.
 *
 * 학생 명단 페이지의 `students-table.tsx` 톤을 따른 작은 버전.
 * 컬럼: 이름 · 학교 · 학년 · 학부모 연락처(마스킹) · 출/결/지/조/보 카운트
 *
 * 이름 셀에서 `/students/[id]` 링크. 학부모 연락처는 항상 마스킹된 상태로
 * 표시 (PRD 6.3 — 명단 같은 high-density 화면에서는 reveal 토글 불필요).
 * 풀 reveal 은 학생 상세에서 가능.
 *
 * Server Component — 한 강좌 수강생은 보통 30명 이하라 가상 스크롤 불필요.
 */
export function ClassStudentsPanel({ students }: Props) {
  if (students.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-white py-16 text-center">
        <p className="text-[15px] text-[color:var(--text-muted)]">
          수강생이 없습니다.
        </p>
        <p className="mt-2 text-[13px] text-[color:var(--text-dim)]">
          이 강좌에 등록된 학생이 없거나 강좌 마스터 매칭이 누락되었습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-white overflow-hidden">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[color:var(--border)] bg-[color:var(--bg-muted)]">
            <Th>이름</Th>
            <Th>학교</Th>
            <Th className="w-20 text-center">학년</Th>
            <Th className="w-40">학부모 연락처</Th>
            <Th className="w-16 text-right">출</Th>
            <Th className="w-16 text-right">결</Th>
            <Th className="w-16 text-right">지</Th>
            <Th className="w-16 text-right">조</Th>
            <Th className="w-16 text-right">보</Th>
          </tr>
        </thead>
        <tbody>
          {students.map((s) => (
            <tr
              key={s.id}
              className="
                border-b border-[color:var(--border)] last:border-b-0
                hover:bg-[color:var(--bg-hover)] transition-colors
              "
            >
              <Td>
                <Link
                  href={`/students/${s.id}`}
                  className="font-medium text-[color:var(--text)] hover:underline"
                >
                  {s.name}
                </Link>
              </Td>
              <Td className="text-[color:var(--text-muted)]">
                {s.school ?? "—"}
              </Td>
              <Td className="text-center text-[color:var(--text)]">
                {s.grade ?? "—"}
              </Td>
              <Td className="text-[color:var(--text-muted)] tabular-nums">
                {s.parent_phone ? maskPhone(s.parent_phone) : "—"}
              </Td>
              <CountTd value={s.attended_count} />
              <CountTd value={s.absent_count} />
              <CountTd value={s.late_count} />
              <CountTd value={s.early_leave_count} />
              <CountTd value={s.makeup_count} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
      scope="col"
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

/**
 * 출결 카운트 셀. 0 이면 dim 한 점, 그 외에는 숫자.
 */
function CountTd({ value }: { value: number }) {
  return (
    <td className="px-4 py-3 text-[15px] text-right tabular-nums text-[color:var(--text)]">
      {value > 0 ? (
        value
      ) : (
        <span className="text-[color:var(--text-dim)]">·</span>
      )}
    </td>
  );
}
