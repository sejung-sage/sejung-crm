"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Grade, StudentProfileRow } from "@/types/database";
import { formatPhone, maskPhone } from "@/lib/phone";
import { StudentStatusBadge } from "@/components/students/status-badge";
import { BranchBadge } from "@/components/students/branch-badge";

interface Props {
  rows: StudentProfileRow[];
  /**
   * 학부모 연락처 풀 노출 권한. master 만 true.
   * false 면 010-****-1234 형태 마스킹.
   */
  canRevealPhone?: boolean;
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
 * 컬럼: 이름 · 학교 · 학년 · 재원 상태 · 출석률 · 출석 · 수강 중 · 학부모 연락처
 *
 * 0012 마이그레이션 이후 학년은 정규화 9종 enum 문자열 그대로 표시
 * (예: "중2", "고3", "재수"). school_level 은 학년 라벨에 이미 포함되어
 * 별도 컬럼을 추가하지 않음.
 *
 * 0066 마이그 이후 컬럼 의미:
 *  - 수강 중 = active_enrollment_count (현재 진행 강좌 수)
 * 출석률(%) 은 0063, 결석은 0066 에서 폐기 (결석 = 환불 처리되므로 운영 무의미).
 *
 * 옛 컬럼 "최근 수강(과목·강사 요약)" 은 학생 상세 페이지에서 더 풍부하게
 * 보여주므로 명단에서는 제거. 행 클릭 시 상세로 이동.
 */
export function StudentsTable({ rows, canRevealPhone = false }: Props) {
  const router = useRouter();
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-bg-card py-16 text-center">
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
    <div className="rounded-xl border border-[color:var(--border)] bg-bg-card overflow-hidden">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[color:var(--border)]">
            <Th>이름</Th>
            <Th>학교</Th>
            <Th className="w-20 text-center">학년</Th>
            <Th className="w-28 text-center">재원 상태</Th>
            <Th className="w-24 text-right">수강 중</Th>
            <Th className="w-40">학부모 연락처</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const dim = isDimmed(r.grade);
            const href = `/students/${r.id}`;
            return (
              <tr
                key={r.id}
                onClick={(e) => {
                  // 셀 내부 a/button (이름 Link 등) 은 자체 클릭 그대로.
                  const t = e.target as HTMLElement;
                  if (t.closest("a, button")) return;
                  // 텍스트 드래그 선택 중이면 무시 — 복사 의도 보존.
                  const sel = window.getSelection();
                  if (sel && sel.toString().length > 0) return;
                  router.push(href);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(href);
                  }
                }}
                role="link"
                tabIndex={0}
                aria-label={`${r.name} 학생 상세로 이동`}
                className={`
                  border-b border-[color:var(--border)] last:border-b-0
                  hover:bg-[color:var(--bg-hover)] transition-colors
                  cursor-pointer
                  focus:outline-none focus-visible:bg-[color:var(--bg-hover)]
                  focus-visible:ring-2 focus-visible:ring-[color:var(--action)]
                  ${dim ? "bg-[color:var(--bg-muted)]" : ""}
                `}
              >
                <Td>
                  <div className="flex items-center gap-2">
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
                    <BranchBadge branch={r.branch} />
                  </div>
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
                <Td className="text-center">
                  <StudentStatusBadge status={r.status} />
                </Td>
                <Td
                  className={`text-right tabular-nums ${
                    dim
                      ? "text-[color:var(--text-dim)]"
                      : "text-[color:var(--text-muted)]"
                  }`}
                  title="현재 진행 중 강좌 수"
                >
                  {`${r.active_enrollment_count}개`}
                </Td>
                <Td
                  className={`tabular-nums ${
                    dim
                      ? "text-[color:var(--text-dim)]"
                      : "text-[color:var(--text-muted)]"
                  }`}
                >
                  {/* 학부모 연락처는 row 클릭으로 상세 이동되면 안 됨 — 셀 내부 클릭은
                      stopPropagation 으로 차단. (현재는 a/button 가드가 row onClick 에
                      있어 plain text 는 단순 클릭이 row 클릭이 되지만, 의도된 동작) */}
                  {canRevealPhone
                    ? formatPhone(r.parent_phone) || "-"
                    : maskPhone(r.parent_phone) || "-"}
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
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <td className={`px-4 py-3 text-[15px] ${className}`} title={title}>
      {children}
    </td>
  );
}
