"use client";

import Link from "next/link";
import type { ClassListItem } from "@/types/database";
import { BranchBadge } from "@/components/groups/branch-badge";

interface Props {
  rows: ClassListItem[];
}

/**
 * F0 · 강좌 리스트 테이블 (Client Component).
 *
 * 컬럼:
 *   반명 · 분원 · 과목 · 강사 · 요일/시간 · 회당단가 · 총회차 · 정가 · 수강생
 *
 * - 반명 셀에 `/classes/[id]` 로 링크. 상세 페이지는 Phase B 에서 생성 예정.
 * - 미사용 강좌(active=false)는 회색조 dim. (`active=0` 토글 시에만 노출됨)
 * - 빈 상태: "검색 조건에 해당하는 강좌가 없습니다."
 *
 * Server Component 로도 충분하지만, 향후 인라인 액션(즐겨찾기 등) 추가 여지를
 * 두고 Client 로 시작. 현재 클라이언트 상태는 없음.
 */
export function ClassesTable({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-white py-16 text-center">
        <p className="text-[15px] text-[color:var(--text-muted)]">
          검색 조건에 해당하는 강좌가 없습니다.
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
            <Th>반명</Th>
            <Th className="w-20">분원</Th>
            <Th className="w-20 text-center">과목</Th>
            <Th className="w-28">강사</Th>
            <Th className="w-36">요일/시간</Th>
            <Th className="w-28 text-right">회당단가</Th>
            <Th className="w-20 text-right">총회차</Th>
            <Th className="w-28 text-right">정가</Th>
            <Th className="w-20 text-right">수강생</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const dim = !r.active;
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
                    href={`/classes/${r.id}`}
                    className={`font-medium hover:underline ${
                      dim
                        ? "text-[color:var(--text-muted)]"
                        : "text-[color:var(--text)]"
                    }`}
                  >
                    {r.name}
                  </Link>
                  {!r.active && (
                    <span
                      className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-medium bg-[color:var(--bg-muted)] text-[color:var(--text-muted)] border border-[color:var(--border)]"
                      title="V_class_list.미사용반구분 = Y"
                    >
                      미사용
                    </span>
                  )}
                </Td>
                <Td>
                  <BranchBadge branch={r.branch} />
                </Td>
                <Td
                  className={`text-center ${
                    dim
                      ? "text-[color:var(--text-dim)]"
                      : "text-[color:var(--text-muted)]"
                  }`}
                >
                  {r.subject ?? "—"}
                </Td>
                <Td
                  className={
                    dim
                      ? "text-[color:var(--text-dim)]"
                      : "text-[color:var(--text-muted)]"
                  }
                >
                  {r.teacher_name ?? "—"}
                </Td>
                <Td
                  className={
                    dim
                      ? "text-[color:var(--text-dim)]"
                      : "text-[color:var(--text-muted)]"
                  }
                >
                  <ScheduleCell
                    days={r.schedule_days}
                    time={r.schedule_time}
                  />
                </Td>
                <Td
                  className={`text-right tabular-nums ${
                    dim
                      ? "text-[color:var(--text-dim)]"
                      : "text-[color:var(--text)]"
                  }`}
                >
                  {formatWon(r.amount_per_session)}
                </Td>
                <Td
                  className={`text-right tabular-nums ${
                    dim
                      ? "text-[color:var(--text-dim)]"
                      : "text-[color:var(--text)]"
                  }`}
                >
                  {formatSessions(r.total_sessions)}
                </Td>
                <Td
                  className={`text-right tabular-nums ${
                    dim
                      ? "text-[color:var(--text-dim)]"
                      : "text-[color:var(--text-muted)]"
                  }`}
                >
                  {formatWon(r.total_amount)}
                </Td>
                <Td
                  className={`text-right tabular-nums font-medium ${
                    dim
                      ? "text-[color:var(--text-muted)]"
                      : "text-[color:var(--text)]"
                  }`}
                >
                  {r.enrolled_student_count.toLocaleString()}명
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── 내부 소 컴포넌트·포매터 ────────────────────────────────

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
 * 요일 + 시간 한 셀에 두 줄 표시.
 * 둘 다 없으면 "—". 한쪽만 있으면 그 한 줄만.
 */
function ScheduleCell({
  days,
  time,
}: {
  days: string | null;
  time: string | null;
}) {
  if (!days && !time) return <span>—</span>;
  return (
    <div className="leading-tight">
      {days && <div>{days}</div>}
      {time && (
        <div className="text-[13px] text-[color:var(--text-dim)] tabular-nums">
          {time}
        </div>
      )}
    </div>
  );
}

/** null/0 이면 "—". 그 외에는 천단위 콤마 + "원". */
function formatWon(v: number | null): string {
  if (v === null || v === undefined) return "—";
  if (v === 0) return "—";
  return `${v.toLocaleString()}원`;
}

/**
 * 총회차 표시: 정수면 정수, 소수면 한 자리만.
 * decimal 원본이라 1.0 같은 케이스도 1 로 정리.
 */
function formatSessions(v: number | null): string {
  if (v === null || v === undefined) return "—";
  if (Number.isInteger(v)) return v.toString();
  return v.toFixed(1);
}
