import type { StudentProfileRow } from "@/types/database";
import { formatPhone, maskPhone } from "@/lib/phone";
import { StudentStatusBadge } from "@/components/students/status-badge";
import { BranchBadge } from "@/components/students/branch-badge";
import { GroupStudentRowActions } from "./group-student-row-actions";

/**
 * 그룹 상세 하단 · 소속 학생 목록 (Server 렌더).
 * F1-01 students-table 과 유사한 스타일을 유지하되 컬럼을 그룹 맥락에 맞게 조정.
 * 학부모 연락처는 PRD 6.3 에 따라 기본 마스킹, master 만 풀 노출.
 *
 * canEdit=true 인 경우 각 행 hover 시 우측 휴지통 아이콘 노출 →
 * 클릭 → 확인 다이얼로그 → `removeStudentFromGroupAction` 호출.
 * canEdit=false (manager/viewer 등) 면 액션 컬럼 자체를 숨김.
 */
interface Props {
  rows: StudentProfileRow[];
  /** 학부모 연락처 풀 노출 권한. master 만 true. */
  canRevealPhone?: boolean;
  /**
   * 그룹 편집 권한 (master 또는 본인 분원 admin).
   * true 면 행별 휴지통(그룹에서 제외) 아이콘 노출.
   */
  canEdit?: boolean;
  /** canEdit 일 때 필요한 그룹 ID. */
  groupId?: string;
}

export function GroupStudentsTable({
  rows,
  canRevealPhone = false,
  canEdit = false,
  groupId,
}: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-bg-card py-12 text-center">
        <p className="text-[15px] text-[color:var(--text-muted)]">
          조건에 해당하는 학생이 없습니다.
        </p>
        <p className="mt-2 text-[13px] text-[color:var(--text-dim)]">
          필터를 조금 더 넓혀 보세요. (비활성·수신거부 학생은 자동 제외됩니다.)
        </p>
      </div>
    );
  }

  // canEdit 일 때만 액션 컬럼 활성. groupId 누락 시엔 type-level 보호용으로 액션 숨김.
  const showActions = canEdit && Boolean(groupId);

  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-bg-card overflow-hidden">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[color:var(--border)] bg-[color:var(--bg-muted)]">
            <Th>이름</Th>
            <Th>학교</Th>
            <Th className="w-20 text-center">학년</Th>
            <Th className="w-28 text-center">재원 상태</Th>
            <Th className="w-40">학부모 연락처</Th>
            <Th>최근 수강</Th>
            {showActions && (
              <Th className="w-12 text-center">
                <span className="sr-only">동작</span>
              </Th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="group border-b border-[color:var(--border)] last:border-b-0 hover:bg-[color:var(--bg-hover)] transition-colors"
            >
              <Td>
                <div className="flex items-center gap-2">
                  <a
                    href={`/students/${r.id}`}
                    className="font-medium text-[color:var(--text)] hover:underline"
                  >
                    {r.name}
                  </a>
                  <BranchBadge branch={r.branch} />
                </div>
              </Td>
              <Td className="text-[color:var(--text-muted)]">
                {r.school ?? "-"}
              </Td>
              <Td className="text-center text-[color:var(--text)]">
                {r.grade ?? "-"}
              </Td>
              <Td className="text-center">
                <StudentStatusBadge status={r.status} />
              </Td>
              <Td className="text-[color:var(--text-muted)] tabular-nums">
                {canRevealPhone
                  ? formatPhone(r.parent_phone) || "-"
                  : maskPhone(r.parent_phone) || "-"}
              </Td>
              <Td className="text-[color:var(--text-muted)]">
                {formatRecent(r)}
              </Td>
              {showActions && groupId && (
                <Td className="text-center">
                  <GroupStudentRowActions
                    groupId={groupId}
                    studentId={r.id}
                    studentName={r.name}
                  />
                </Td>
              )}
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
