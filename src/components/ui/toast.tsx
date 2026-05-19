"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";

/**
 * 세정-CRM 가벼운 토스트 시스템 (외부 라이브러리 없음).
 *
 * - 우측 하단 stacking, 자동 4.5초 dismiss.
 * - kind: 'success' | 'error'. 디자인 토큰만 사용 (흰색+검정 미니멀).
 * - root layout 의 ToastProvider 안에서 useToast() 로 접근.
 *
 * 사용 예 (client component 안):
 *   const { show } = useToast();
 *   show("success", "저장됐어요");
 *   show("error", "저장 실패: 권한 없음");
 *
 * App Router navigation 시 root layout 의 ToastProvider 가 보존 →
 * 페이지 redirect 후에도 토스트가 자연스럽게 유지됨.
 */

type ToastKind = "success" | "error";

interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  duration: number;
}

interface ToastContextValue {
  show: (
    kind: ToastKind,
    message: string,
    options?: { duration?: number },
  ) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 4500;

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast 는 <ToastProvider> 안에서만 사용 가능합니다");
  }
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((arr) => arr.filter((t) => t.id !== id));
  }, []);

  const show = useCallback<ToastContextValue["show"]>(
    (kind, message, options) => {
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `t_${Date.now()}_${Math.random()}`;
      const duration = options?.duration ?? DEFAULT_DURATION_MS;
      setToasts((arr) => [...arr, { id, kind, message, duration }]);
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="fixed right-4 bottom-4 z-50 flex flex-col gap-2 pointer-events-none"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const id = setTimeout(onDismiss, toast.duration);
    return () => clearTimeout(id);
  }, [toast.duration, onDismiss]);

  const Icon = toast.kind === "success" ? CheckCircle2 : AlertCircle;
  const tone =
    toast.kind === "success"
      ? "text-[color:var(--success)]"
      : "text-[color:var(--danger)]";

  return (
    <div
      role="status"
      className="
        pointer-events-auto
        min-w-[260px] max-w-md
        flex items-start gap-3
        px-4 py-3 rounded-lg
        bg-bg-card border border-[color:var(--border)]
        shadow-md
      "
    >
      <Icon
        className={`size-5 shrink-0 mt-0.5 ${tone}`}
        strokeWidth={1.75}
        aria-hidden
      />
      <p className="flex-1 text-[14px] text-[color:var(--text)] leading-relaxed break-words">
        {toast.message}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="알림 닫기"
        className="
          inline-flex items-center justify-center
          size-6 rounded-md shrink-0
          text-[color:var(--text-muted)]
          hover:text-[color:var(--text)] hover:bg-[color:var(--bg-hover)]
          transition-colors
        "
      >
        <X className="size-3.5" strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  );
}
