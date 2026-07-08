"use client";

import Link from "next/link";
import { Send } from "lucide-react";
import type { SeminarListItem } from "@/lib/seminars/list-seminars";
import { BranchBadge } from "@/components/groups/branch-badge";
import { formatKstDateTime } from "@/lib/datetime";

interface Props {
  rows: SeminarListItem[];
  /**
   * 행별 "발송" 액션을 노출할 분원 집합.
   *  - null     → 전체 분원 허용 (master)
   *  - string[] → 해당 분원 설명회에만 노출 (admin = 본인 분원). 빈 배열이면 전부 미노출.
   *
   * 강좌 리스트(ClassesTable) 와 동일 기준 — 상위(page)에서 산출해 내린다.
   */
  sendableBranches?: string[] | null;
}

/**
 * 설명회 전용 목록 테이블.
 *
 * 컬럼 (좌→우):
 *   설명회명 · 분원 · 일시 · 신청현황 · 상태 · 발송
 *
 * - 설명회명 셀은 `/classes/[id]` 로 링크 (상세는 강좌 상세 라우트 공용).
 * - 일시(held_at): KST 표기, 없으면 "—".
 * - 신청현황: effective_capacity 있으면 진행바(검정 채움/회색 트랙) + "signed/cap",
 *   없으면 "N명 신청".
 * - 상태: signup_status → 공개중/마감/초안/미생성 뱃지.
 * - 발송: 권한 분원에 한해 `/seminars/compose?class=<id>` 진입.
 */
export function SeminarsTable({ rows, sendableBranches = null }: Props) {
  const showSendColumn =
    sendableBranches === null || sendableBranches.length > 0;

  const canSendBranch = (branch: string): boolean =>
    sendableBranches === null || sendableBranches.includes(branch);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-bg-card py-16 text-center">
        <p className="text-[15px] text-[color:var(--text-muted)]">
          조건에 해당하는 설명회가 없습니다.
        </p>
        <p className="mt-2 text-[13px] text-[color:var(--text-dim)]">
          검색어나 분원을 바꿔보세요. 설명회는 강좌 등록 시 과목을 “설명회”로
          지정하면 이곳에 나타납니다.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-bg-card overflow-hidden">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[color:var(--border)]">
            <Th>설명회명</Th>
            <Th className="w-20">분원</Th>
            <Th className="w-44">일시</Th>
            <Th className="w-24 text-center">상태</Th>
            {showSendColumn && <Th className="w-24 text-center">발송</Th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="
                border-b border-[color:var(--border)] last:border-b-0
                hover:bg-[color:var(--bg-hover)] transition-colors
              "
            >
              <Td>
                <Link
                  href={`/classes/${r.id}`}
                  className="font-medium text-[color:var(--text)] hover:underline"
                >
                  {r.name}
                </Link>
                {r.teacher_name && (
                  <span className="ml-2 text-[13px] text-[color:var(--text-muted)]">
                    {r.teacher_name}
                  </span>
                )}
              </Td>
              <Td>
                <BranchBadge branch={r.branch} />
              </Td>
              <Td className="text-[14px] text-[color:var(--text-muted)] tabular-nums">
                {r.held_at ? formatKstDateTime(r.held_at) : "—"}
              </Td>
              <Td className="text-center">
                <StatusBadge status={r.signup_status} />
              </Td>
              {showSendColumn && (
                <Td className="text-center">
                  {canSendBranch(r.branch) && (
                    <Link
                      href={`/seminars/compose?class=${r.id}`}
                      aria-label={`${r.name} 설명회로 문자 발송`}
                      title="이 설명회로 발송"
                      className="
                        inline-flex items-center gap-1
                        h-9 px-2.5 rounded-lg
                        text-[13px] font-medium
                        text-[color:var(--text-muted)]
                        border border-[color:var(--border)]
                        hover:bg-[color:var(--bg-hover)]
                        hover:text-[color:var(--text)]
                        transition-colors
                      "
                    >
                      <Send className="size-3.5" strokeWidth={1.75} aria-hidden />
                      발송
                    </Link>
                  )}
                </Td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── 내부 소 컴포넌트 ────────────────────────────────────────

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
 * 신청 페이지 상태 뱃지.
 *  - open    : 공개중 (검정 채움)
 *  - closed  : 마감 (muted)
 *  - draft   : 초안 (점선 테두리)
 *  - null    : 미생성 (점선 테두리)
 */
function StatusBadge({
  status,
}: {
  status: "draft" | "open" | "closed" | null;
}) {
  if (status === "open") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[12px] font-medium bg-[color:var(--action)] text-[color:var(--action-text)]">
        공개중
      </span>
    );
  }
  if (status === "closed") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[12px] border border-[color:var(--border)] text-[color:var(--text-muted)] bg-[color:var(--bg-muted)]">
        마감
      </span>
    );
  }
  if (status === "draft") {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-[12px] border border-dashed border-[color:var(--border-strong)] text-[color:var(--text-muted)]">
        초안
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[12px] border border-dashed border-[color:var(--border-strong)] text-[color:var(--text-dim)]">
      미생성
    </span>
  );
}
