"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  Copy,
  MoreHorizontal,
  Pencil,
  Send,
  Trash2,
} from "lucide-react";
import type { GroupListItem } from "@/types/database";
import { BranchBadge } from "@/components/groups/branch-badge";
import {
  deleteGroupAction,
  deleteGroupsAction,
} from "@/app/(features)/groups/actions";

interface Props {
  rows: GroupListItem[];
}

/**
 * F2-01 · 발송 그룹 리스트 테이블 (Client Component).
 *
 * 기능:
 *  - 체크박스 선택 (헤더 = 전체 토글)
 *  - 1개 이상 선택 시 상단 액션 바 노출 → "N개 선택됨 / 삭제"
 *  - 행 클릭 → /groups/[id]
 *  - ⋯ 메뉴: 수정 · 복제 · 삭제 · 이 그룹으로 발송(F3 전까지 비활성)
 *  - dev-seed 모드 응답은 안내 메시지로 표시
 *
 * 복잡한 DropdownMenu 대신 경량 커스텀 메뉴(버튼 + 조건부 패널)로 포커스 트랩 없이 구현.
 * 키보드 접근성은 Tab + Enter + Esc 로 충분히 동작.
 */
export function GroupsTable({ rows }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<null | {
    kind: "single";
    id: string;
    name: string;
  } | { kind: "bulk"; ids: string[] }>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const allChecked = useMemo(
    () => rows.length > 0 && rows.every((r) => selected.has(r.id)),
    [rows, selected],
  );
  const someChecked = selected.size > 0 && !allChecked;

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-white py-16 text-center">
        <p className="text-[15px] text-[color:var(--text-muted)]">
          아직 발송 그룹이 없습니다.
        </p>
        <p className="mt-2 text-[13px] text-[color:var(--text-dim)]">
          우측 상단 &lsquo;그룹 추가하기&rsquo; 로 첫 그룹을 만들어 보세요.
        </p>
      </div>
    );
  }

  const toggleOne = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    if (checked) setSelected(new Set(rows.map((r) => r.id)));
    else setSelected(new Set());
  };

  const onRowClick = (id: string) => {
    router.push(`/groups/${id}`);
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    setErrorMsg(null);
    startTransition(async () => {
      if (pendingDelete.kind === "single") {
        const result = await deleteGroupAction(pendingDelete.id);
        if (result.status === "success") {
          setNotice("그룹이 삭제되었습니다.");
          setSelected((prev) => {
            const next = new Set(prev);
            next.delete(pendingDelete.id);
            return next;
          });
          router.refresh();
        } else if (result.status === "dev_seed_mode") {
          setNotice(
            "개발용 시드 데이터라 실제 삭제되지 않습니다. Supabase 연결 후 동작합니다.",
          );
        } else {
          setErrorMsg(result.reason);
        }
      } else {
        const result = await deleteGroupsAction(pendingDelete.ids);
        if (result.status === "success") {
          setNotice(`${result.count}개 그룹이 삭제되었습니다.`);
          setSelected(new Set());
          router.refresh();
        } else if (result.status === "dev_seed_mode") {
          setNotice(
            "개발용 시드 데이터라 실제 삭제되지 않습니다. Supabase 연결 후 동작합니다.",
          );
        } else {
          setErrorMsg(result.reason);
        }
      }
      setPendingDelete(null);
    });
  };

  return (
    <div className="space-y-3">
      {/* 선택 액션 바 */}
      {selected.size > 0 && (
        <div
          className="
            flex items-center justify-between gap-4
            px-4 py-2.5 rounded-lg
            border border-[color:var(--border)] bg-[color:var(--bg-muted)]
          "
        >
          <span className="text-[14px] text-[color:var(--text)]">
            <strong className="font-semibold">{selected.size}개</strong> 선택됨
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="
                inline-flex items-center h-9 px-3 rounded-lg
                text-[14px] text-[color:var(--text-muted)]
                hover:text-[color:var(--text)] hover:bg-[color:var(--bg-hover)]
                transition-colors
              "
            >
              선택 해제
            </button>
            <button
              type="button"
              onClick={() =>
                setPendingDelete({
                  kind: "bulk",
                  ids: Array.from(selected),
                })
              }
              className="
                inline-flex items-center gap-1.5 h-9 px-3 rounded-lg
                border border-[color:var(--border)] bg-white
                text-[14px] text-[color:var(--danger)]
                hover:bg-[color:var(--danger-bg)]
                transition-colors
              "
            >
              <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
              삭제
            </button>
          </div>
        </div>
      )}

      {/* 안내/오류 메시지 */}
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
              <Th className="w-10 text-center">
                <input
                  type="checkbox"
                  aria-label="전체 선택"
                  checked={allChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = someChecked;
                  }}
                  onChange={(e) => toggleAll(e.target.checked)}
                  className="size-4 cursor-pointer accent-[color:var(--action)]"
                />
              </Th>
              <Th className="w-20">분원</Th>
              <Th>그룹명</Th>
              <Th className="w-28 text-right">총 연락처</Th>
              <Th className="w-32">최근 발송일</Th>
              <Th>마지막 발송 내용</Th>
              <Th className="w-12" aria-label="메뉴">
                <span className="sr-only">메뉴</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const checked = selected.has(r.id);
              return (
                <tr
                  key={r.id}
                  className="border-b border-[color:var(--border)] last:border-b-0 hover:bg-[color:var(--bg-hover)] transition-colors cursor-pointer"
                  onClick={(e) => {
                    // 체크박스·메뉴 클릭은 행 이동에서 제외
                    const target = e.target as HTMLElement;
                    if (
                      target.closest("[data-row-stop]") ||
                      target.tagName === "INPUT" ||
                      target.tagName === "BUTTON"
                    ) {
                      return;
                    }
                    onRowClick(r.id);
                  }}
                >
                  <Td className="text-center" onClickStop>
                    <input
                      type="checkbox"
                      aria-label={`${r.name} 선택`}
                      checked={checked}
                      onChange={(e) => toggleOne(r.id, e.target.checked)}
                      className="size-4 cursor-pointer accent-[color:var(--action)]"
                    />
                  </Td>
                  <Td>
                    <BranchBadge branch={r.branch} />
                  </Td>
                  <Td>
                    <Link
                      href={`/groups/${r.id}`}
                      className="font-medium text-[color:var(--text)] hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.name}
                    </Link>
                  </Td>
                  <Td className="text-right tabular-nums font-medium text-[color:var(--text)]">
                    {r.recipient_count.toLocaleString()}명
                  </Td>
                  <Td className="text-[color:var(--text-muted)] tabular-nums">
                    {formatDate(r.last_sent_at)}
                  </Td>
                  <Td className="text-[color:var(--text-muted)]">
                    <span className="line-clamp-1 block max-w-[32ch]">
                      {r.last_message_preview ?? "—"}
                    </span>
                  </Td>
                  <Td className="text-center relative" onClickStop>
                    <RowMenu
                      open={openMenuId === r.id}
                      onOpenChange={(open) =>
                        setOpenMenuId(open ? r.id : null)
                      }
                      onEdit={() => {
                        setOpenMenuId(null);
                        router.push(`/groups/${r.id}/edit`);
                      }}
                      onDuplicate={() => {
                        setOpenMenuId(null);
                        setNotice(
                          "그룹 복제는 Phase 1 에서 제공됩니다. 동일한 조건으로 새 그룹을 만들어 주세요.",
                        );
                      }}
                      onDelete={() => {
                        setOpenMenuId(null);
                        setPendingDelete({
                          kind: "single",
                          id: r.id,
                          name: r.name,
                        });
                      }}
                      onSend={() => {
                        // F3 전까지 비활성
                        setOpenMenuId(null);
                      }}
                    />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 삭제 확인 다이얼로그 */}
      {pendingDelete && (
        <ConfirmDialog
          title="그룹을 삭제할까요?"
          description={
            pendingDelete.kind === "single"
              ? `'${pendingDelete.name}' 그룹을 삭제합니다. 이미 발송된 캠페인 기록은 보존됩니다.`
              : `선택한 ${pendingDelete.ids.length}개 그룹을 삭제합니다. 이미 발송된 캠페인 기록은 보존됩니다.`
          }
          confirmLabel="삭제"
          confirmTone="danger"
          busy={isPending}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
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

function RowMenu({
  open,
  onOpenChange,
  onEdit,
  onDuplicate,
  onDelete,
  onSend,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSend: () => void;
}) {
  return (
    <div className="relative inline-block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="그룹 메뉴 열기"
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
          {/* 바깥 클릭 닫힘 영역 */}
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
            <MenuItem icon={Copy} onClick={onDuplicate}>
              복제
            </MenuItem>
            <MenuItem
              icon={Send}
              disabled
              title="문자 발송 모듈 완성 시 활성화"
              onClick={onSend}
            >
              이 그룹으로 발송
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
              inline-flex items-center h-10 px-4 rounded-lg
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
              inline-flex items-center h-10 px-4 rounded-lg
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
  // YYYY-MM-DD 로 잘라서 노출 (timezone 영향 최소화)
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[1]}-${m[2]}-${m[3]}`;
}
