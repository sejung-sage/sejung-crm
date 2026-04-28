"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Props {
  page: number;
  pageSize: number;
  total: number;
}

/**
 * 학생 목록 페이지네이션. URL ?page= 기반.
 */
export function Pagination({ page, pageSize, total }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const go = (next: number) => {
    const clamped = Math.min(Math.max(1, next), totalPages);
    const params = new URLSearchParams(searchParams.toString());
    if (clamped === 1) params.delete("page");
    else params.set("page", String(clamped));
    router.push(`${pathname}?${params.toString()}`);
  };

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between pt-2">
      <p className="text-[13px] text-[color:var(--text-muted)]">
        {total === 0 ? "0명" : `${start.toLocaleString()}–${end.toLocaleString()} / ${total.toLocaleString()}명`}
      </p>

      <div className="flex items-center gap-1">
        <PageBtn
          disabled={page <= 1}
          onClick={() => go(page - 1)}
          aria-label="이전 페이지"
        >
          <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
        </PageBtn>
        <span className="px-3 text-[14px] text-[color:var(--text)] tabular-nums">
          {page} / {totalPages}
        </span>
        <PageBtn
          disabled={page >= totalPages}
          onClick={() => go(page + 1)}
          aria-label="다음 페이지"
        >
          <ChevronRight className="size-4" strokeWidth={1.75} aria-hidden />
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
        border border-[color:var(--border)] bg-white
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
