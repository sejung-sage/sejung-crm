"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Copy, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import type { CampaignListItem } from "@/types/database";
import { CampaignStatusBadge } from "@/components/campaigns/campaign-status-badge";

interface Props {
  rows: CampaignListItem[];
}

/**
 * F3-02 · 캠페인 리스트 테이블 (Client Component).
 *
 * 기능:
 *  - 행 클릭 → /campaigns/[id]
 *  - ⋯ 메뉴: 재발송(비활성+툴팁) · 복제(안내) · 삭제(안내 — Part B 에서 실구현)
 *  - 도달률 · 비용 표시
 *
 * 재발송/삭제 실구현은 Part B 에서 server action 연동 후 활성화.
 */
export function CampaignsTable({ rows }: Props) {
  const router = useRouter();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-white py-16 text-center">
        <p className="text-[15px] text-[color:var(--text-muted)]">
          아직 발송 내역이 없습니다.
        </p>
        <p className="mt-2 text-[13px] text-[color:var(--text-dim)]">
          발송 그룹에서 &lsquo;이 그룹으로 발송&rsquo; 을 눌러 첫 캠페인을
          만들어 보세요.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {notice && (
        <div
          role="status"
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-4 py-2.5 text-[14px] text-[color:var(--text-muted)]"
        >
          {notice}
        </div>
      )}

      <div className="rounded-xl border border-[color:var(--border)] bg-white overflow-visible">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[color:var(--border)] bg-[color:var(--bg-muted)]">
              <Th>제목</Th>
              <Th className="w-36">그룹명</Th>
              <Th className="w-40">발송 / 예약</Th>
              <Th className="w-24">상태</Th>
              <Th className="w-24 text-right">도달률</Th>
              <Th className="w-28 text-right">비용</Th>
              <Th className="w-12" aria-label="메뉴">
                <span className="sr-only">메뉴</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const reach =
                c.total_recipients > 0
                  ? Math.round((c.delivered_count / c.total_recipients) * 100)
                  : 0;
              const sendTime = c.sent_at ?? c.scheduled_at;
              const sendLabel = c.sent_at
                ? "발송"
                : c.scheduled_at
                  ? "예약"
                  : null;
              return (
                <tr
                  key={c.id}
                  className="border-b border-[color:var(--border)] last:border-b-0 hover:bg-[color:var(--bg-hover)] transition-colors cursor-pointer"
                  onClick={(e) => {
                    const target = e.target as HTMLElement;
                    if (
                      target.closest("[data-row-stop]") ||
                      target.tagName === "BUTTON" ||
                      target.tagName === "A"
                    ) {
                      return;
                    }
                    router.push(`/campaigns/${c.id}`);
                  }}
                >
                  <Td>
                    <Link
                      href={`/campaigns/${c.id}`}
                      className="font-medium text-[color:var(--text)] hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {c.title}
                    </Link>
                    {c.template_name && (
                      <p className="mt-0.5 text-[12px] text-[color:var(--text-muted)]">
                        템플릿: {c.template_name}
                      </p>
                    )}
                  </Td>
                  <Td className="text-[color:var(--text-muted)]">
                    {c.group_name ?? "—"}
                  </Td>
                  <Td className="tabular-nums">
                    {sendTime ? (
                      <>
                        <span className="text-[12px] text-[color:var(--text-dim)] mr-1">
                          {sendLabel}
                        </span>
                        <span className="text-[color:var(--text)]">
                          {formatDateTime(sendTime)}
                        </span>
                      </>
                    ) : (
                      <span className="text-[color:var(--text-dim)]">—</span>
                    )}
                  </Td>
                  <Td>
                    <CampaignStatusBadge status={c.status} />
                  </Td>
                  <Td className="text-right tabular-nums text-[color:var(--text-muted)]">
                    {c.total_recipients > 0 ? (
                      <>
                        <span className="text-[color:var(--text)] font-medium">
                          {reach}%
                        </span>
                        <span className="ml-1 text-[12px]">
                          ({c.delivered_count}/{c.total_recipients})
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td className="text-right tabular-nums text-[color:var(--text)]">
                    {c.total_cost.toLocaleString()}원
                  </Td>
                  <Td className="text-center relative" onClickStop>
                    <RowMenu
                      open={openMenuId === c.id}
                      onOpenChange={(open) =>
                        setOpenMenuId(open ? c.id : null)
                      }
                      onResend={() => {
                        setOpenMenuId(null);
                      }}
                      onDuplicate={() => {
                        setOpenMenuId(null);
                        setNotice(
                          "캠페인 복제는 Phase 1 에서 제공됩니다. 문자 작성 페이지에서 같은 템플릿으로 새 캠페인을 만들어 주세요.",
                        );
                      }}
                      onDelete={() => {
                        setOpenMenuId(null);
                        setNotice(
                          "캠페인 삭제는 Part B 에서 제공됩니다 (발송 기록은 회계 감사를 위해 보존).",
                        );
                      }}
                    />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── 내부 소 컴포넌트 ───────────────────────────────────────

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
  onClickStop,
}: {
  children: React.ReactNode;
  className?: string;
  onClickStop?: boolean;
}) {
  return (
    <td
      className={`px-4 py-3 text-[15px] ${className}`}
      data-row-stop={onClickStop ? "" : undefined}
      onClick={onClickStop ? (e) => e.stopPropagation() : undefined}
    >
      {children}
    </td>
  );
}

function RowMenu({
  open,
  onOpenChange,
  onResend,
  onDuplicate,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResend: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="relative inline-block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="캠페인 메뉴 열기"
        onClick={(e) => {
          e.stopPropagation();
          onOpenChange(!open);
        }}
        className="
          inline-flex items-center justify-center
          size-8 rounded-md
          text-[color:var(--text-muted)]
          hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text)]
          transition-colors
        "
      >
        <MoreHorizontal className="size-4" strokeWidth={1.75} aria-hidden />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => onOpenChange(false)}
            className="fixed inset-0 z-10 cursor-default bg-transparent"
          />
          <div
            role="menu"
            className="
              absolute right-0 top-full z-20 mt-1 min-w-44
              rounded-lg border border-[color:var(--border)] bg-white
              shadow-md py-1
            "
          >
            <MenuItem
              icon={RotateCcw}
              disabled
              title="실제 발송 API 연동 후 활성화됩니다"
              onClick={onResend}
            >
              재발송
            </MenuItem>
            <MenuItem icon={Copy} onClick={onDuplicate}>
              복제
            </MenuItem>
            <div className="my-1 h-px bg-[color:var(--border)]" />
            <MenuItem icon={Trash2} tone="danger" onClick={onDelete}>
              삭제
            </MenuItem>
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  children,
  onClick,
  tone = "default",
  disabled,
  title,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  children: React.ReactNode;
  onClick?: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
  title?: string;
}) {
  const color =
    tone === "danger"
      ? "text-[color:var(--danger)]"
      : "text-[color:var(--text)]";
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`
        flex items-center gap-2 w-full px-3 py-2 text-left
        text-[14px] ${color}
        hover:bg-[color:var(--bg-hover)]
        disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent
        transition-colors
      `}
    >
      <Icon className="size-4" strokeWidth={1.75} aria-hidden />
      {children}
    </button>
  );
}

function formatDateTime(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return iso;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}
