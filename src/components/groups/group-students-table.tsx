import type { StudentProfileRow } from "@/types/database";
import { maskPhone } from "@/lib/phone";
import { StudentStatusBadge } from "@/components/students/status-badge";

/**
 * 그룹 상세 하단 · 소속 학생 목록 (Server 렌더).
 * F1-01 students-table 과 유사한 스타일을 유지하되 컬럼을 그룹 맥락에 맞게 조정.
 * 학부모 연락처는 PRD 6.3 에 따라 마스킹 표시.
 */
interface Props {
  rows: StudentProfileRow[];
}

export function GroupStudentsTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-white py-12 text-center">
        <p className="text-[15px] text-[color:var(--text-muted)]">
          조건에 해당하는 학생이 없습니다.
        </p>
        <p className="mt-2 text-[13px] text-[color:var(--text-dim)]">
          필터를 조금 더 넓혀 보세요. (비활성·수신거부 학생은 자동 제외됩니다.)
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
                <a
                  href={`/students/${r.id}`}
                  className="font-medium text-[color:var(--text)] hover:underline"
                >
                  {r.name}
                </a>
              </Td>
              <Td className="text-[color:var(--text-muted)]">
                {r.school ?? "-"}
              </Td>
              <Td className="text-center text-[color:var(--text)]">
                {r.grade ? `고${r.grade}` : "-"}
              </Td>
              <Td className="text-center">
                <StudentStatusBadge status={r.status} />
              </Td>
              <Td className="text-[color:var(--text-muted)] tabular-nums">
                {maskPhone(r.parent_phone) || "-"}
              </Td>
              <Td className="text-[color:var(--text-muted)]">
                {formatRecent(r)}
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

function formatRecent(r: StudentProfileRow): string {
  if (!r.subjects || r.subjects.length === 0) return "-";
  const subjects = r.subjects.slice(0, 2).join(", ");
  const teacher =
    r.teachers && r.teachers.length > 0 ? ` · ${r.teachers[0]}` : "";
  return `${subjects}${teacher}`;
}
