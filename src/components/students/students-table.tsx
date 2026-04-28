import Link from "next/link";
import type { StudentProfileRow } from "@/types/database";
import { formatPhone } from "@/lib/phone";
import { StudentStatusBadge } from "@/components/students/status-badge";

interface Props {
  rows: StudentProfileRow[];
}

/**
 * 학생 목록 테이블 (서버 렌더).
 * 컬럼: 이름 · 학교 · 학년 · 계열 · 재원 상태 · 학부모 연락처 · 최근 수강
 */
export function StudentsTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-white py-16 text-center">
        <p className="text-[15px] text-[color:var(--text-muted)]">
          조건에 맞는 학생이 없습니다.
        </p>
        <p className="mt-2 text-[13px] text-[color:var(--text-dim)]">
          검색어를 지우거나 필터를 조정해 보세요.
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
            <Th className="w-20 text-center">계열</Th>
            <Th className="w-28 text-center">재원 상태</Th>
            <Th className="w-40">학부모 연락처</Th>
            <Th>최근 수강</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="border-b border-[color:var(--border)] last:border-b-0 hover:bg-[color:var(--bg-hover)] transition-colors"
            >
              <Td>
                <Link
                  href={`/students/${r.id}`}
                  className="font-medium text-[color:var(--text)] hover:underline"
                >
                  {r.name}
                </Link>
              </Td>
              <Td className="text-[color:var(--text-muted)]">
                {r.school ?? "-"}
              </Td>
              <Td className="text-center text-[color:var(--text)]">
                {r.grade ? `고${r.grade}` : "-"}
              </Td>
              <Td className="text-center text-[color:var(--text-muted)]">
                {r.track ?? "-"}
              </Td>
              <Td className="text-center">
                <StudentStatusBadge status={r.status} />
              </Td>
              <Td className="text-[color:var(--text-muted)] tabular-nums">
                {formatPhone(r.parent_phone) || "-"}
              </Td>
              <Td className="text-[color:var(--text-muted)]">
                {formatRecentEnrollment(r)}
              </Td>
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
  return (
    <td className={`px-4 py-3 text-[15px] ${className}`}>{children}</td>
  );
}

function formatRecentEnrollment(r: StudentProfileRow): string {
  if (!r.subjects || r.subjects.length === 0) return "-";
  const subjects = r.subjects.slice(0, 2).join(", ");
  const teacher =
    r.teachers && r.teachers.length > 0 ? ` · ${r.teachers[0]}` : "";
  return `${subjects}${teacher}`;
}
