"use client";

import { useEffect, useRef } from "react";

/**
 * 공용 확인 다이얼로그.
 *
 * 사용 의도:
 *  - 되돌리기 어려운 저장/삭제/비활성화 동작 직전 한 번 더 확인.
 *  - 키보드 사용자 배려: Esc 로 취소, Enter 로 확인(autoFocus 된 버튼).
 *  - 다이얼로그 마운트 시 confirm 버튼에 포커스 → 의도가 명확한 사용자는
 *    Enter 한 번으로 진행, 의도 불명확한 사용자는 멈춰 다시 확인.
 *
 * 디자인 가드:
 *  - 흰 + 검정 미니멀. confirmTone="danger" 일 때만 빨간 강조.
 *  - body 스크롤 잠금 (열려있는 동안 페이지 스크롤 차단).
 *  - z-index 50 — toast(40 가정)보다 위.
 *
 * 사용 예:
 * ```tsx
 * <ConfirmDialog
 *   title="변경사항을 저장할까요?"
 *   description="저장하면 발송 그룹의 수신자 조건이 즉시 적용됩니다."
 *   confirmLabel="저장"
 *   busy={isPending}
 *   onCancel={() => setConfirming(false)}
 *   onConfirm={() => doSave()}
 * />
 * ```
 */
export interface ConfirmDialogProps {
  title: string;
  description?: React.ReactNode;
  /** 확인 버튼 라벨. 기본 "확인". */
  confirmLabel?: string;
  /** 취소 버튼 라벨. 기본 "취소". */
  cancelLabel?: string;
  /** 확인 버튼 톤. "primary" = 검정, "danger" = 빨강. 기본 "primary". */
  confirmTone?: "primary" | "danger";
  /** 진행 중 상태 — 양쪽 버튼 비활성 + "처리 중..." 표시. */
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel = "확인",
  cancelLabel = "취소",
  confirmTone = "primary",
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // 마운트 시 confirm 버튼 autoFocus + body 스크롤 잠금.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // 다음 tick 에 포커스 (모달 애니메이션·CSS 적용 후)
    const t = setTimeout(() => confirmRef.current?.focus(), 0);
    return () => {
      clearTimeout(t);
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby={description ? "confirm-dialog-desc" : undefined}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-bg-card border border-[color:var(--border)] shadow-lg p-6 space-y-4">
        <h2
          id="confirm-dialog-title"
          className="text-[18px] font-semibold text-[color:var(--text)]"
        >
          {title}
        </h2>
        {description && (
          <div
            id="confirm-dialog-desc"
            className="text-[14px] text-[color:var(--text-muted)] leading-relaxed"
          >
            {description}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="
              inline-flex items-center h-10 px-4 rounded-lg
              border border-[color:var(--border)] bg-bg-card
              text-[14px] text-[color:var(--text)]
              hover:bg-[color:var(--bg-hover)]
              disabled:opacity-50
              transition-colors
            "
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
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
