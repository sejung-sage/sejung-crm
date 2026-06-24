"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CampaignMessageRow, MessageStatus } from "@/types/database";
import type { CampaignMessageCounts } from "@/lib/campaigns/get-campaign-message-counts";
import { MessageStatusBadge } from "@/components/campaigns/campaign-status-badge";
import { ResendSingleButton } from "@/components/campaigns/resend-single-button";
import { formatPhone, maskPhone } from "@/lib/phone";
import { formatKstDateTime } from "@/lib/datetime";

interface Props {
  rows: CampaignMessageRow[];
  /**
   * 상태별 전체 건수 (서버 head 쿼리). 칩 카운트는 rows(로드 상한 있음)가 아니라
   * 이 값을 신뢰 — 6만 건 캠페인처럼 rows 가 잘려도 칩 수치는 정확히 유지된다.
   */
  counts: CampaignMessageCounts;
  /** 학부모 연락처 풀 노출 권한. master 만 true. */
  canRevealPhone?: boolean;
  /** 행별 재발송 권한. false 면 재발송 컬럼 자체를 숨김. */
  canResend?: boolean;
}

// "도달" status 는 sendon webhook/polling 미구현으로 영원히 0건 → 칩 노출 제외.
// MessageStatus enum 자체는 유지 (DB 컬럼 + 향후 도달 추적 추가 시 그대로 사용 가능).
const STATUS_CHIPS: Array<{ value: "ALL" | MessageStatus; label: string }> = [
  { value: "ALL", label: "전체" },
  { value: "대기", label: "대기" },
  { value: "발송됨", label: "발송됨" },
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
export function CampaignMessagesTable({
  rows,
  counts,
  canRevealPhone = false,
  canResend = false,
}: Props) {
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
            chip.value === "ALL" ? counts.total : counts[chip.value];
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
                    : "bg-bg-card border border-[color:var(--border)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text)]"
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
        <div className="rounded-xl border border-[color:var(--border)] bg-bg-card py-12 text-center">
          <p className="text-[14px] text-[color:var(--text-muted)]">
            해당 상태의 메시지가 없습니다.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[color:var(--border)] bg-bg-card overflow-visible">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[color:var(--border)] bg-[color:var(--bg-muted)]">
                <Th className="w-40">학생명</Th>
                <Th className="w-44">수신번호</Th>
                <Th className="w-24">상태</Th>
                <Th className="w-40">발송시각</Th>
                <Th>실패 사유</Th>
                {canResend && (
                  <Th className="w-28 text-right">재발송</Th>
                )}
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => (
                <tr
                  key={m.id}
                  className="border-b border-[color:var(--border)] last:border-b-0 hover:bg-[color:var(--bg-hover)] transition-colors"
                >
                  <Td className="text-[color:var(--text)]">
                    {m.student_id ? (
                      // 학생 연결이 있으면 이름 클릭 시 학생 상세로 이동(새 탭).
                      <Link
                        href={`/students/${m.student_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-[color:var(--text)] hover:underline"
                      >
                        {m.student_name ?? "(이름 없음)"}
                      </Link>
                    ) : (
                      (m.student_name ?? (
                        <span className="text-[color:var(--text-dim)]">
                          (학생 정보 없음)
                        </span>
                      ))
                    )}
                  </Td>
                  <Td className="tabular-nums text-[color:var(--text-muted)]">
                    {canRevealPhone
                      ? formatPhone(m.phone) || maskPhone(m.phone)
                      : maskPhone(m.phone)}
                  </Td>
                  <Td>
                    <MessageStatusBadge status={m.status} />
                  </Td>
                  <Td className="tabular-nums text-[color:var(--text-muted)]">
                    {formatDateTime(m.sent_at)}
                  </Td>
                  <Td className="text-[13px] text-[color:var(--text-muted)]">
                    {m.failed_reason ?? (
                      <span className="text-[color:var(--text-dim)]">—</span>
                    )}
                  </Td>
                  {canResend && (
                    <Td className="text-right">
                      <div className="flex justify-end">
                        <ResendSingleButton
                          messageId={m.id}
                          status={m.status}
                          studentName={m.student_name ?? null}
                        />
                      </div>
                    </Td>
                  )}
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
        border border-[color:var(--border)] bg-bg-card
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
  // KST 변환. 옛 substring 패턴은 UTC 가 그대로 노출되어 사용자가
  // "발송시각이 이상하다" 호소 — datetime 유틸로 통일.
  return formatKstDateTime(iso);
}
