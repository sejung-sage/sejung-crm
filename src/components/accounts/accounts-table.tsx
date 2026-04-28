"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  MoreHorizontal,
  Pencil,
  PowerOff,
  Power,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import type { AccountListItem } from "@/types/database";
import { RoleBadge } from "@/components/auth/role-badge";
import { BranchBadge } from "@/components/groups/branch-badge";
import {
  deactivateAccountAction,
  reactivateAccountAction,
} from "@/app/(features)/accounts/actions";

interface Props {
  rows: AccountListItem[];
  /** 본인 계정 비활성화 차단을 위해 필요. */
  currentUserId: string;
}

type PendingAction =
  | { kind: "deactivate"; userId: string; name: string }
  | { kind: "reactivate"; userId: string; name: string };

/**
 * F4 · 계정 리스트 테이블 (Client Component).
 *
 * 기능:
 *  - 행 클릭 → /accounts/[user_id]/edit
 *  - ⋯ 메뉴: 수정 · 비활성화/활성화
 *  - 비활성화/활성화는 확인 다이얼로그 → Server Action
 *  - 본인 계정은 비활성화 메뉴 비활성화(자기 자신 차단)
 *  - 비활성 행은 muted 톤
 *  - dev_seed_mode 응답은 회색 안내 메시지
 *
 * 디자인은 GroupsTable 패턴을 그대로 따름(흑백 미니멀 · 헤더 muted 13px).
 */
export function AccountsTable({ rows, currentUserId }: Props) {
  const router = useRouter();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-white py-16 text-center">
        <p className="text-[15px] text-[color:var(--text-muted)]">
          조건에 해당하는 계정이 없습니다.
        </p>
        <p className="mt-2 text-[13px] text-[color:var(--text-dim)]">
          우측 상단 &lsquo;계정 생성&rsquo; 으로 새 계정을 추가할 수 있습니다.
        </p>
      </div>
    );
  }

  const onRowClick = (id: string) => {
    router.push(`/accounts/${id}/edit`);
  };

  const confirmAction = () => {
    if (!pending) return;
    setErrorMsg(null);
    startTransition(async () => {
      const result =
        pending.kind === "deactivate"
          ? await deactivateAccountAction(pending.userId)
          : await reactivateAccountAction(pending.userId);

      if (result.status === "success") {
        setNotice(
          pending.kind === "deactivate"
            ? `'${pending.name}' 계정을 비활성화했습니다.`
            : `'${pending.name}' 계정을 활성화했습니다.`,
        );
        router.refresh();
      } else if (result.status === "dev_seed_mode") {
        setNotice(
          "개발용 시드 데이터라 실제 반영되지 않습니다. Supabase 연결 후 동작합니다.",
        );
      } else {
        setErrorMsg(result.reason);
      }
      setPending(null);
    });
  };

  return (
    <div className="space-y-3">
      {/* 안내/오류 */}
      {notice && (
        <div
          role="status"
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-4 py-2.5 text-[14px] text-[color:var(--text-muted)]"
        >
          {notice}
        </div>
      )}
      {errorMsg && (
        <div
          role="alert"
          className="rounded-lg border border-[color:var(--danger)] bg-[color:var(--danger-bg)] px-4 py-2.5 text-[14px] text-[color:var(--danger)]"
        >
          {errorMsg}
        </div>
      )}

      {/* 테이블 */}
      <div className="rounded-xl border border-[color:var(--border)] bg-white overflow-visible">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[color:var(--border)] bg-[color:var(--bg-muted)]">
              <Th>이름</Th>
              <Th>이메일</Th>
              <Th className="w-24">권한</Th>
              <Th className="w-20">분원</Th>
              <Th className="w-24">상태</Th>
              <Th className="w-32">최근 수정일</Th>
              <Th className="w-12" aria-label="메뉴">
                <span className="sr-only">메뉴</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isSelf = r.user_id === currentUserId;
              const inactive = !r.active;
              return (
                <tr
                  key={r.user_id}
                  className={`
                    border-b border-[color:var(--border)] last:border-b-0
                    hover:bg-[color:var(--bg-hover)] transition-colors cursor-pointer
                    ${inactive ? "text-[color:var(--text-muted)]" : ""}
                  `}
                  onClick={(e) => {
                    const target = e.target as HTMLElement;
                    if (
                      target.closest("[data-row-stop]") ||
                      target.tagName === "BUTTON"
                    ) {
                      return;
                    }
                    onRowClick(r.user_id);
                  }}
                >
                  <Td>
                    <Link
                      href={`/accounts/${r.user_id}/edit`}
                      onClick={(e) => e.stopPropagation()}
                      className={`
                        font-medium hover:underline
                        ${
                          inactive
                            ? "text-[color:var(--text-muted)]"
                            : "text-[color:var(--text)]"
                        }
                      `}
                    >
                      {r.name}
                    </Link>
                    {isSelf && (
                      <span className="ml-2 text-[12px] text-[color:var(--text-dim)]">
                        (본인)
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span
                      className={
                        inactive
                          ? "text-[color:var(--text-muted)]"
                          : "text-[color:var(--text)]"
                      }
                    >
                      {r.email ?? "—"}
                    </span>
                  </Td>
                  <Td>
                    <RoleBadge role={r.role} />
                  </Td>
                  <Td>
                    <BranchBadge branch={r.branch} />
                  </Td>
                  <Td>
                    <StatusPill active={r.active} />
                  </Td>
                  <Td className="text-[color:var(--text-muted)] tabular-nums">
                    {formatDate(r.updated_at)}
                  </Td>
                  <Td className="text-center relative" onClickStop>
                    <RowMenu
                      open={openMenuId === r.user_id}
                      onOpenChange={(open) =>
                        setOpenMenuId(open ? r.user_id : null)
                      }
                      onEdit={() => {
                        setOpenMenuId(null);
                        router.push(`/accounts/${r.user_id}/edit`);
                      }}
                      active={r.active}
                      isSelf={isSelf}
                      onToggleActive={() => {
                        setOpenMenuId(null);
                        setPending(
                          r.active
                            ? {
                                kind: "deactivate",
                                userId: r.user_id,
                                name: r.name,
                              }
                            : {
                                kind: "reactivate",
                                userId: r.user_id,
                                name: r.name,
                              },
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

      {/* 확인 다이얼로그 */}
      {pending && (
        <ConfirmDialog
          title={
            pending.kind === "deactivate"
              ? "계정을 비활성화할까요?"
              : "계정을 활성화할까요?"
          }
          description={
            pending.kind === "deactivate"
              ? `'${pending.name}' 계정을 비활성화합니다. 비활성화된 계정은 즉시 로그인이 차단됩니다. 다시 활성화하면 기존 권한으로 복구됩니다.`
              : `'${pending.name}' 계정을 활성화합니다. 활성화 후 다시 로그인할 수 있습니다.`
          }
          confirmLabel={pending.kind === "deactivate" ? "비활성화" : "활성화"}
          confirmTone={pending.kind === "deactivate" ? "danger" : "default"}
          busy={isPending}
          onCancel={() => setPending(null)}
          onConfirm={confirmAction}
        />
      )}
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

function StatusPill({ active }: { active: boolean }) {
  if (active) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-medium bg-[color:var(--bg-muted)] text-[color:var(--text)]"
        aria-label="상태: 활성"
      >
        <CheckCircle2 className="size-3" strokeWidth={2} aria-hidden />
        활성
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-medium bg-[color:var(--bg-muted)] text-[color:var(--text-muted)] border border-[color:var(--border)]"
      aria-label="상태: 비활성"
    >
      <XCircle className="size-3" strokeWidth={2} aria-hidden />
      비활성
    </span>
  );
}

function RowMenu({
  open,
  onOpenChange,
  onEdit,
  active,
  isSelf,
  onToggleActive,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
  active: boolean;
  isSelf: boolean;
  onToggleActive: () => void;
}) {
  return (
    <div className="relative inline-block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="계정 메뉴 열기"
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
            <MenuItem icon={Pencil} onClick={onEdit}>
              수정
            </MenuItem>
            <div className="my-1 h-px bg-[color:var(--border)]" />
            {active ? (
              <MenuItem
                icon={PowerOff}
                tone="danger"
                disabled={isSelf}
                title={
                  isSelf ? "본인 계정은 비활성화할 수 없습니다" : undefined
                }
                onClick={onToggleActive}
              >
                비활성화
              </MenuItem>
            ) : (
              <MenuItem icon={Power} onClick={onToggleActive}>
                활성화
              </MenuItem>
            )}
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

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  confirmTone = "default",
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  confirmTone?: "default" | "danger";
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-white border border-[color:var(--border)] shadow-lg p-6 space-y-4">
        <h2
          id="confirm-title"
          className="text-[18px] font-semibold text-[color:var(--text)]"
        >
          {title}
        </h2>
        <p className="text-[14px] text-[color:var(--text-muted)] leading-relaxed">
          {description}
        </p>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="
              inline-flex items-center h-11 px-4 rounded-lg
              border border-[color:var(--border)] bg-white
              text-[14px] text-[color:var(--text)]
              hover:bg-[color:var(--bg-hover)]
              disabled:opacity-50
              transition-colors
            "
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`
              inline-flex items-center h-11 px-4 rounded-lg
              text-[14px] font-medium
              disabled:opacity-50 transition-colors
              ${
                confirmTone === "danger"
                  ? "bg-[color:var(--danger)] text-white hover:opacity-90"
                  : "bg-[color:var(--action)] text-[color:var(--action-text)] hover:bg-[color:var(--action-hover)]"
              }
            `}
          >
            {busy ? "처리 중..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[1]}-${m[2]}-${m[3]}`;
}
