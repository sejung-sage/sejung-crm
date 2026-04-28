"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Copy, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { TemplateRow } from "@/types/database";
import {
  AdBadge,
  TemplateTypeBadge,
} from "@/components/templates/template-type-badge";
import { BYTE_LIMITS } from "@/lib/schemas/template";
import { deleteTemplateAction } from "@/app/(features)/templates/actions";

interface Props {
  rows: TemplateRow[];
}

/**
 * F3-01 · 템플릿 리스트 테이블 (Client Component).
 *
 * 기능:
 *  - 행 클릭 · 제목 링크 → /templates/[id]/edit
 *  - ⋯ 메뉴: 수정 · 복제(안내 메시지) · 삭제(확인 다이얼로그)
 *  - dev-seed 모드 응답은 회색 안내 박스로 표시.
 *
 * 디자인: groups-table 과 동일 패턴. 체크박스·일괄 삭제는 F3-A 범위 외라 생략.
 */
export function TemplatesTable({ rows }: Props) {
  const router = useRouter();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<null | {
    id: string;
    name: string;
  }>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-white py-16 text-center">
        <p className="text-[15px] text-[color:var(--text-muted)]">
          아직 템플릿이 없습니다.
        </p>
        <p className="mt-2 text-[13px] text-[color:var(--text-dim)]">
          우측 상단 &lsquo;새 템플릿&rsquo; 으로 첫 템플릿을 만들어 보세요.
        </p>
      </div>
    );
  }

  const confirmDelete = () => {
    if (!pendingDelete) return;
    setErrorMsg(null);
    startTransition(async () => {
      const result = await deleteTemplateAction(pendingDelete.id);
      if (result.status === "success") {
        setNotice("템플릿이 삭제되었습니다.");
        router.refresh();
      } else if (result.status === "dev_seed_mode") {
        setNotice(
          "개발용 시드 데이터라 실제 삭제되지 않습니다. Supabase 연결 후 동작합니다.",
        );
      } else {
        setErrorMsg(result.reason);
      }
      setPendingDelete(null);
    });
  };

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
      {errorMsg && (
        <div
          role="alert"
          className="rounded-lg border border-[color:var(--danger)] bg-[color:var(--danger-bg)] px-4 py-2.5 text-[14px] text-[color:var(--danger)]"
        >
          {errorMsg}
        </div>
      )}

      <div className="rounded-xl border border-[color:var(--border)] bg-white overflow-visible">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[color:var(--border)] bg-[color:var(--bg-muted)]">
              <Th>제목</Th>
              <Th className="w-20">유형</Th>
              <Th className="w-16">광고</Th>
              <Th className="w-28">강사명</Th>
              <Th className="w-32 text-right">바이트</Th>
              <Th className="w-32">최근 수정일</Th>
              <Th className="w-12" aria-label="메뉴">
                <span className="sr-only">메뉴</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const limit = BYTE_LIMITS[t.type];
              return (
                <tr
                  key={t.id}
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
                    router.push(`/templates/${t.id}/edit`);
                  }}
                >
                  <Td>
                    <Link
                      href={`/templates/${t.id}/edit`}
                      className="font-medium text-[color:var(--text)] hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t.name}
                    </Link>
                    {t.subject && (
                      <p className="mt-0.5 text-[12px] text-[color:var(--text-muted)] line-clamp-1 max-w-[48ch]">
                        {t.subject}
                      </p>
                    )}
                  </Td>
                  <Td>
                    <TemplateTypeBadge type={t.type} />
                  </Td>
                  <Td>{t.is_ad ? <AdBadge /> : null}</Td>
                  <Td className="text-[color:var(--text-muted)]">
                    {t.teacher_name ?? "—"}
                  </Td>
                  <Td className="text-right tabular-nums">
                    <span
                      className={
                        t.byte_count > limit
                          ? "text-[color:var(--danger)] font-medium"
                          : "text-[color:var(--text-muted)]"
                      }
                    >
                      {t.byte_count.toLocaleString()} / {limit.toLocaleString()}
                    </span>
                  </Td>
                  <Td className="text-[color:var(--text-muted)] tabular-nums">
                    {formatDate(t.updated_at)}
                  </Td>
                  <Td className="text-center relative" onClickStop>
                    <RowMenu
                      open={openMenuId === t.id}
                      onOpenChange={(open) =>
                        setOpenMenuId(open ? t.id : null)
                      }
                      onEdit={() => {
                        setOpenMenuId(null);
                        router.push(`/templates/${t.id}/edit`);
                      }}
                      onDuplicate={() => {
                        setOpenMenuId(null);
                        setNotice(
                          "템플릿 복제는 Phase 1 에서 제공됩니다. 동일한 본문으로 새 템플릿을 만들어 주세요.",
                        );
                      }}
                      onDelete={() => {
                        setOpenMenuId(null);
                        setPendingDelete({ id: t.id, name: t.name });
                      }}
                    />
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="템플릿을 삭제할까요?"
          description={`'${pendingDelete.name}' 템플릿을 삭제합니다. 이미 발송된 캠페인 기록은 보존됩니다.`}
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="relative inline-block">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="템플릿 메뉴 열기"
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
              absolute right-0 top-full z-20 mt-1 min-w-40
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
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  children: React.ReactNode;
  onClick?: () => void;
  tone?: "default" | "danger";
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
      className={`
        flex items-center gap-2 w-full px-3 py-2 text-left
        text-[14px] ${color}
        hover:bg-[color:var(--bg-hover)]
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
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[1]}-${m[2]}-${m[3]}`;
}
