"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { Plus, Search } from "lucide-react";

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "전체 상태" },
  { value: "임시저장", label: "임시저장" },
  { value: "예약됨", label: "예약됨" },
  { value: "발송중", label: "발송중" },
  { value: "완료", label: "완료" },
  { value: "실패", label: "실패" },
  { value: "취소", label: "취소" },
];

/**
 * F3-02 · 캠페인 리스트 상단 툴바.
 *
 * - 좌: 제목 검색 · 상태 드롭다운 · 기간(from/to)
 * - URL `?q=&status=&from=&to=` 동기화. 값 변경 시 page=1 리셋.
 */
export function CampaignsToolbar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const q = searchParams.get("q") ?? "";
  const status = searchParams.get("status") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  const updateParams = useCallback(
    (mutator: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams.toString());
      mutator(next);
      next.delete("page");
      startTransition(() => {
        router.push(`${pathname}?${next.toString()}`);
      });
    },
    [router, pathname, searchParams],
  );

  const onSearchSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const value = String(data.get("q") ?? "").trim();
    updateParams((p) => {
      if (value) p.set("q", value);
      else p.delete("q");
    });
  };

  const onStatusChange = (value: string) => {
    updateParams((p) => {
      if (value) p.set("status", value);
      else p.delete("status");
    });
  };

  const onDateChange = (key: "from" | "to", value: string) => {
    updateParams((p) => {
      if (value) p.set(key, value);
      else p.delete(key);
    });
  };

  return (
    <div
      className="flex flex-col md:flex-row md:flex-wrap md:items-center gap-3"
      aria-busy={isPending}
    >
      <form onSubmit={onSearchSubmit} className="flex-1 min-w-[240px]">
        <label className="relative block">
          <span className="sr-only">캠페인 제목 검색</span>
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[color:var(--text-dim)]"
            strokeWidth={1.75}
            aria-hidden
          />
          <input
            name="q"
            type="search"
            defaultValue={q}
            placeholder="제목 검색"
            className="
              w-full h-10 rounded-lg
              pl-9 pr-3
              bg-white
              border border-[color:var(--border)]
              text-[15px] text-[color:var(--text)]
              placeholder:text-[color:var(--text-dim)]
              focus:outline-none focus:border-[color:var(--border-strong)]
              transition-colors
            "
          />
        </label>
      </form>

      <select
        aria-label="상태 선택"
        value={status}
        onChange={(e) => onStatusChange(e.target.value)}
        className="
          h-10 min-w-36 rounded-lg px-3
          bg-white border border-[color:var(--border)]
          text-[15px] text-[color:var(--text)]
          focus:outline-none focus:border-[color:var(--border-strong)]
          cursor-pointer
        "
      >
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-[13px] text-[color:var(--text-muted)]">
          <span className="sr-only">기간 시작일</span>
          <input
            type="date"
            value={from}
            onChange={(e) => onDateChange("from", e.target.value)}
            className="
              h-10 rounded-lg px-3
              bg-white border border-[color:var(--border)]
              text-[14px] text-[color:var(--text)]
              focus:outline-none focus:border-[color:var(--border-strong)]
              cursor-pointer
            "
          />
        </label>
        <span className="text-[13px] text-[color:var(--text-muted)]">~</span>
        <label className="flex items-center gap-2 text-[13px] text-[color:var(--text-muted)]">
          <span className="sr-only">기간 종료일</span>
          <input
            type="date"
            value={to}
            onChange={(e) => onDateChange("to", e.target.value)}
            className="
              h-10 rounded-lg px-3
              bg-white border border-[color:var(--border)]
              text-[14px] text-[color:var(--text)]
              focus:outline-none focus:border-[color:var(--border-strong)]
              cursor-pointer
            "
          />
        </label>
      </div>

      <Link
        href="/compose"
        className="
          inline-flex items-center gap-1.5 h-10 px-4 rounded-lg
          bg-[color:var(--action)] text-[color:var(--action-text)]
          text-[14px] font-medium
          hover:bg-[color:var(--action-hover)]
          transition-colors
          md:ml-auto
        "
      >
        <Plus className="size-4" strokeWidth={2} aria-hidden />
        새 발송
      </Link>
    </div>
  );
}
