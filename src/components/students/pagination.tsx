"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
} from "lucide-react";

interface Props {
  page: number;
  pageSize: number;
  total: number;
}

/**
 * 학생 목록 페이지네이션. URL ?page= 기반.
 *
 * 필터 바와 동일한 전체 화면 dim + 스피너 오버레이를 useTransition isPending
 * 으로 띄운다 — App Router 의 같은 segment navigation (searchParams 만 변경)
 * 에서는 loading.tsx 가 자동 노출되지 않아 직접 표시해야 한다.
 */
export function Pagination({ page, pageSize, total }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const go = (next: number) => {
    const clamped = Math.min(Math.max(1, next), totalPages);
    if (clamped === page) return;
    const params = new URLSearchParams(searchParams.toString());
    if (clamped === 1) params.delete("page");
    else params.set("page", String(clamped));
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between pt-2" aria-busy={isPending}>
      {isPending && (
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          className="fixed inset-0 z-40 bg-black/15 backdrop-blur-[1px] flex items-center justify-center cursor-wait"
          onMouseDownCapture={(e) => e.preventDefault()}
          onClickCapture={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <div className="flex items-center gap-3 px-5 py-3.5 rounded-xl bg-bg-card border border-[color:var(--border)] shadow-md">
            <Loader2
              className="size-5 animate-spin text-[color:var(--text-muted)]"
              strokeWidth={1.75}
              aria-hidden
            />
            <span className="text-[14px] text-[color:var(--text)]">
              불러오는 중...
            </span>
          </div>
        </div>
      )}
      <p className="text-[13px] text-[color:var(--text-muted)]">
        {total === 0 ? "0명" : `${start.toLocaleString()}–${end.toLocaleString()} / ${total.toLocaleString()}명`}
      </p>

      <div className="flex items-center gap-1">
        <PageBtn
          disabled={page <= 1 || isPending}
          onClick={() => go(1)}
          aria-label="첫 페이지"
        >
          <ChevronsLeft className="size-4" strokeWidth={1.75} aria-hidden />
        </PageBtn>
        <PageBtn
          disabled={page <= 1 || isPending}
          onClick={() => go(page - 1)}
          aria-label="이전 페이지"
        >
          <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
        </PageBtn>
        <span className="px-3 text-[14px] text-[color:var(--text)] tabular-nums">
          {page} / {totalPages}
        </span>
        <PageBtn
          disabled={page >= totalPages || isPending}
          onClick={() => go(page + 1)}
          aria-label="다음 페이지"
        >
          <ChevronRight className="size-4" strokeWidth={1.75} aria-hidden />
        </PageBtn>
        <PageBtn
          disabled={page >= totalPages || isPending}
          onClick={() => go(totalPages)}
          aria-label="마지막 페이지"
        >
          <ChevronsRight className="size-4" strokeWidth={1.75} aria-hidden />
        </PageBtn>
      </div>
    </div>
  );
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
        size-9 rounded-lg
        border border-[color:var(--border)] bg-bg-card
        text-[color:var(--text)]
        hover:bg-[color:var(--bg-hover)]
        disabled:opacity-40 disabled:cursor-not-allowed
        transition-colors
      "
    >
      {children}
    </button>
  );
}
