"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { Plus, Search } from "lucide-react";

import { BRANCH_FILTER_OPTIONS } from "@/config/branches";

/**
 * F2-01 · 발송 그룹 리스트 상단 툴바.
 *
 * - 좌: 그룹명 검색(form submit) + 분원 드롭다운(즉시 반영)
 * - 우: "+ 그룹 추가하기" 검정 CTA → /groups/new
 *
 * 상태는 URL `?q=`, `?branch=` 로 동기화. 필터 변경 시 page=1 리셋.
 */
export function GroupsToolbar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const q = searchParams.get("q") ?? "";
  const branch = searchParams.get("branch") ?? "전체";

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

  const onBranchChange = (value: string) => {
    updateParams((p) => {
      if (value === "전체") p.delete("branch");
      else p.set("branch", value);
    });
  };

  return (
    <div
      className="flex flex-col md:flex-row md:items-center gap-3"
      aria-busy={isPending}
    >
      <form onSubmit={onSearchSubmit} className="flex-1">
        <label className="relative block">
          <span className="sr-only">그룹명 검색</span>
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[color:var(--text-dim)]"
            strokeWidth={1.75}
            aria-hidden
          />
          <input
            name="q"
            type="search"
            defaultValue={q}
            placeholder="그룹명 검색"
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
        aria-label="분원 선택"
        value={branch}
        onChange={(e) => onBranchChange(e.target.value)}
        className="
          h-10 min-w-40 rounded-lg px-3
          bg-white border border-[color:var(--border)]
          text-[15px] text-[color:var(--text)]
          focus:outline-none focus:border-[color:var(--border-strong)]
          cursor-pointer
        "
      >
        {BRANCH_FILTER_OPTIONS.map((b) => (
          <option key={b} value={b}>
            {b === "전체" ? "전체 분원" : b}
          </option>
        ))}
      </select>

      <Link
        href="/groups/new"
        className="
          inline-flex items-center justify-center gap-1.5
          h-10 px-4 rounded-lg
          bg-[color:var(--action)] text-[color:var(--action-text)]
          text-[14px] font-medium
          hover:bg-[color:var(--action-hover)]
          transition-colors shrink-0
        "
      >
        <Plus className="size-4" strokeWidth={2} aria-hidden />
        그룹 추가하기
      </Link>
    </div>
  );
}
