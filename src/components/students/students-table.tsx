import Link from "next/link";
import type { Grade, StudentProfileRow } from "@/types/database";
import { formatPhone } from "@/lib/phone";
import { StudentStatusBadge } from "@/components/students/status-badge";

interface Props {
  rows: StudentProfileRow[];
}

/**
 * 졸업·미정 학생은 운영 시야에서 시선이 가지 않게 dim 처리.
 * `include_hidden=1` 토글이 켜졌을 때만 행에 노출되며, 그때도 회색조로 보여
 * 정규 운영 학생과 시각적으로 분리된다.
 */
const DIMMED_GRADES: ReadonlySet<Grade> = new Set(["졸업", "미정"]);

function isDimmed(grade: Grade | null): boolean {
  return grade !== null && DIMMED_GRADES.has(grade);
}

/**
 * 학생 목록 테이블 (서버 렌더).
 * 컬럼: 이름 · 학교 · 학년 · 계열 · 재원 상태 · 학부모 연락처 · 최근 수강
 *
 * 0012 마이그레이션 이후 학년은 정규화 9종 enum 문자열 그대로 표시
 * (예: "중2", "고3", "재수"). school_level 은 학년 라벨에 이미 포함되어
 * 별도 컬럼을 추가하지 않음.
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
          {rows.map((r) => {
            const dim = isDimmed(r.grade);
            return (
              <tr
                key={r.id}
                className={`
                  border-b border-[color:var(--border)] last:border-b-0
                  hover:bg-[color:var(--bg-hover)] transition-colors
                  ${dim ? "bg-[color:var(--bg-muted)]" : ""}
                `}
              >
                <Td>
                  <Link
                    href={`/students/${r.id}`}
                    className={`font-medium hover:underline ${
                      dim
                        ? "text-[color:var(--text-muted)]"
                        : "text-[color:var(--text)]"
                    }`}
                  >
                    {r.name}
                  </Link>
                </Td>
                <Td
                  className={
                    dim
                      ? "text-[color:var(--text-dim)]"
                      : "text-[color:var(--text-muted)]"
                  }
                >
                  {r.school ?? "-"}
                </Td>
                <Td
                  className={`text-center ${
                    dim
                      ? "text-[color:var(--text-muted)]"
                      : "text-[color:var(--text)]"
                  }`}
                >
                  {r.grade ?? "-"}
                </Td>
                <Td
                  className={`text-center ${
                    dim
                      ? "text-[color:var(--text-dim)]"
                      : "text-[color:var(--text-muted)]"
                  }`}
                >
                  {r.track ?? "-"}
                </Td>
                <Td className="text-center">
                  <StudentStatusBadge status={r.status} />
                </Td>
                <Td
                  className={`tabular-nums ${
                    dim
                      ? "text-[color:var(--text-dim)]"
                      : "text-[color:var(--text-muted)]"
                  }`}
                >
                  {formatPhone(r.parent_phone) || "-"}
                </Td>
                <Td
                  className={
                    dim
                      ? "text-[color:var(--text-dim)]"
                      : "text-[color:var(--text-muted)]"
                  }
                >
                  {formatRecentEnrollment(r)}
                </Td>
              </tr>
            );
          })}
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
