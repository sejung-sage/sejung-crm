"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { Search, X } from "lucide-react";

import { BRANCH_FILTER_OPTIONS } from "@/config/branches";

/**
 * 설명회 목록(/seminars) 상단 슬림 툴바.
 *
 * 강좌 툴바(ClassesToolbar) 는 과목·요일·강사·기간 등 필터가 많아 설명회 화면엔
 * 과하므로, 설명회에는 검색 + 분원(master 만) 두 가지만 둔다.
 *
 * 필터 토글 패턴은 강좌·학생 리스트와 동일:
 *  - router.push + router.refresh 동반 (prefetch cache stale 방어)
 *  - useTransition 으로 pending dim
 *  - 필터 변경 시 page 항상 1 로 리셋
 *
 * URL 동기화:
 *  - ?q=...      : 검색 (설명회명/강사명)
 *  - ?branch=대치 : 분원 (master 만 변경 가능)
 */
interface Props {
  /** master 만 분원 select 노출. 그 외는 사이드바 표시로 충분. */
  canPickBranch: boolean;
}

export function SeminarsToolbar({ canPickBranch }: Props) {
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
        router.refresh();
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

  const hasActiveFilters = q !== "" || branch !== "전체";

  const clearAll = () => {
    updateParams((p) => {
      p.delete("q");
      p.delete("branch");
    });
  };

  return (
    <div
      className={`flex flex-col md:flex-row md:items-center gap-3 transition-opacity ${
        isPending ? "opacity-60 pointer-events-none" : ""
      }`}
      aria-busy={isPending}
    >
      <form onSubmit={onSearchSubmit} className="flex-1">
        <label className="relative block">
          <span className="sr-only">설명회명 또는 강사명 검색</span>
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[color:var(--text-dim)]"
            strokeWidth={1.75}
            aria-hidden
          />
          <input
            name="q"
            type="search"
            defaultValue={q}
            placeholder="설명회명 또는 강사명 검색"
            className="
              w-full h-10 rounded-lg
              pl-9 pr-3
              bg-bg-card
              border border-[color:var(--border)]
              text-[15px] text-[color:var(--text)]
              placeholder:text-[color:var(--text-dim)]
              focus:outline-none focus:border-[color:var(--border-strong)]
              transition-colors
            "
          />
        </label>
      </form>

      {canPickBranch && (
        <select
          aria-label="분원 선택"
          value={branch}
          onChange={(e) => onBranchChange(e.target.value)}
          className="
            h-10 min-w-40 rounded-lg px-3
            bg-bg-card border border-[color:var(--border)]
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
      )}

      {hasActiveFilters && (
        <button
          type="button"
          onClick={clearAll}
          aria-label="검색·분원 필터 초기화"
          className="
            inline-flex items-center gap-1.5 h-10 px-3 rounded-lg
            text-[14px] font-medium
            text-[color:var(--text-muted)] border border-[color:var(--border)] bg-bg-card
            hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text)]
            transition-colors
          "
        >
          <X className="size-4" strokeWidth={1.75} aria-hidden />
          초기화
        </button>
      )}
    </div>
  );
}
