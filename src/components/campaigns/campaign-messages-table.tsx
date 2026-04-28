"use client";

import { useMemo, useState } from "react";
import type { CampaignMessageRow, MessageStatus } from "@/types/database";
import { MessageStatusBadge } from "@/components/campaigns/campaign-status-badge";
import { maskPhone } from "@/lib/phone";

interface Props {
  rows: CampaignMessageRow[];
}

const STATUS_CHIPS: Array<{ value: "ALL" | MessageStatus; label: string }> = [
  { value: "ALL", label: "전체" },
  { value: "대기", label: "대기" },
  { value: "발송됨", label: "발송됨" },
  { value: "도달", label: "도달" },
  { value: "실패", label: "실패" },
];

const PAGE_SIZE = 50;

/**
 * F3-02 · 캠페인 건별 메시지 테이블 (Client Component).
 *
 * 기능:
 *  - 상단 칩: 상태 필터 (전체/대기/발송됨/도달/실패)
 *  - 페이지네이션 (50건/페이지)
 *  - 수신번호는 마스킹된 형태로만 노출 (학부모 연락처 보호)
 *  - 실패 사유는 작은 회색 텍스트로 행 아래 병기
 */
export function CampaignMessagesTable({ rows }: Props) {
  const [statusFilter, setStatusFilter] = useState<"ALL" | MessageStatus>(
    "ALL",
  );
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    if (statusFilter === "ALL") return rows;
    return rows.filter((r) => r.status === statusFilter);
  }, [rows, statusFilter]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);

  const counts = useMemo(() => {
    const c = { 대기: 0, 발송됨: 0, 도달: 0, 실패: 0 };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);

  const onFilterChange = (v: "ALL" | MessageStatus) => {
    setStatusFilter(v);
    setPage(1);
  };

  return (
    <div className="space-y-3">
      {/* 상태 필터 칩 */}
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_CHIPS.map((chip) => {
          const active = statusFilter === chip.value;
          const count =
            chip.value === "ALL" ? rows.length : counts[chip.value];
          return (
            <button
              key={chip.value}
              type="button"
              onClick={() => onFilterChange(chip.value)}
              className={`
                inline-flex items-center gap-1.5 h-9 px-3 rounded-full
                text-[13px] font-medium
                transition-colors
                ${
                  active
                    ? "bg-[color:var(--action)] text-[color:var(--action-text)]"
                    : "bg-white border border-[color:var(--border)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text)]"
                }
              `}
            >
              <span>{chip.label}</span>
              <span
                className={`tabular-nums ${
                  active
                    ? "text-[color:var(--action-text)] opacity-80"
                    : "text-[color:var(--text-dim)]"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* 테이블 */}
      {visible.length === 0 ? (
        <div className="rounded-xl border border-[color:var(--border)] bg-white py-12 text-center">
          <p className="text-[14px] text-[color:var(--text-muted)]">
            해당 상태의 메시지가 없습니다.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[color:var(--border)] bg-white overflow-visible">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[color:var(--border)] bg-[color:var(--bg-muted)]">
                <Th className="w-40">학생명</Th>
                <Th className="w-44">수신번호</Th>
                <Th className="w-24">상태</Th>
                <Th className="w-40">발송시각</Th>
                <Th className="w-40">도달시각</Th>
                <Th>실패 사유</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => (
                <tr
                  key={m.id}
                  className="border-b border-[color:var(--border)] last:border-b-0 hover:bg-[color:var(--bg-hover)] transition-colors"
                >
                  <Td className="text-[color:var(--text)]">
                    {m.student_name ?? (
                      <span className="text-[color:var(--text-dim)]">
                        (학생 정보 없음)
                      </span>
                    )}
                  </Td>
                  <Td className="tabular-nums text-[color:var(--text-muted)]">
                    {maskPhone(m.phone)}
                  </Td>
                  <Td>
                    <MessageStatusBadge status={m.status} />
                  </Td>
                  <Td className="tabular-nums text-[color:var(--text-muted)]">
                    {formatDateTime(m.sent_at)}
                  </Td>
                  <Td className="tabular-nums text-[color:var(--text-muted)]">
                    {formatDateTime(m.delivered_at)}
                  </Td>
                  <Td className="text-[13px] text-[color:var(--text-muted)]">
                    {m.failed_reason ?? (
                      <span className="text-[color:var(--text-dim)]">—</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 페이지네이션 */}
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-[13px] text-[color:var(--text-muted)]">
            {start + 1}–{Math.min(start + PAGE_SIZE, total)} / {total}건
          </p>
          <div className="flex items-center gap-1">
            <PageBtn
              disabled={safePage <= 1}
              onClick={() => setPage(Math.max(1, safePage - 1))}
              aria-label="이전 페이지"
            >
              이전
            </PageBtn>
            <span className="px-3 text-[14px] text-[color:var(--text)] tabular-nums">
              {safePage} / {totalPages}
            </span>
            <PageBtn
              disabled={safePage >= totalPages}
              onClick={() => setPage(Math.min(totalPages, safePage + 1))}
              aria-label="다음 페이지"
            >
              다음
            </PageBtn>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  className = "",
  ...rest
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      {...rest}
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

function PageBtn({
  children,
  onClick,
  disabled,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="
        inline-flex items-center justify-center
        h-9 px-3 rounded-lg
        border border-[color:var(--border)] bg-white
        text-[14px] text-[color:var(--text)]
        hover:bg-[color:var(--bg-hover)]
        disabled:opacity-40 disabled:cursor-not-allowed
        transition-colors
      "
    >
      {children}
    </button>
  );
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return iso;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}
