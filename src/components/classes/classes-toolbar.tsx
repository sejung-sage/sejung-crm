"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { Search } from "lucide-react";

import { BRANCH_FILTER_OPTIONS } from "@/config/branches";

/**
 * F0 · 강좌 리스트 상단 툴바.
 *
 * - 좌: 반명/강사명 검색(form submit) + 분원 드롭다운(즉시 반영)
 *   + 과목 드롭다운(즉시 반영) + "미사용 포함" 토글
 * - 우: (없음 — 강좌 추가는 MVP 범위 밖)
 *
 * 상태는 URL 로 동기화. `groups-toolbar.tsx` 와 동일 패턴.
 *  - ?q=...        : 검색
 *  - ?branch=대치  : 분원
 *  - ?subject=수학 : 과목
 *  - ?active=0     : 미사용 강좌 포함 (기본은 미사용 숨김)
 *
 * 필터 변경 시 page 는 항상 1 로 리셋.
 */

const SUBJECT_OPTIONS = ["전체", "수학", "국어", "영어", "탐구"] as const;

export function ClassesToolbar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const q = searchParams.get("q") ?? "";
  const branch = searchParams.get("branch") ?? "전체";
  const subjectParam = searchParams.get("subject");
  const subject =
    subjectParam === "수학" ||
    subjectParam === "국어" ||
    subjectParam === "영어" ||
    subjectParam === "탐구"
      ? subjectParam
      : "전체";
  // active 의 기본은 true (미사용 숨김). ?active=0 이면 미사용 포함(체크됨).
  const includeInactive = searchParams.get("active") === "0";

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

  const onSubjectChange = (value: string) => {
    updateParams((p) => {
      if (value === "전체") p.delete("subject");
      else p.set("subject", value);
    });
  };

  const toggleIncludeInactive = () => {
    updateParams((p) => {
      if (includeInactive) p.delete("active");
      else p.set("active", "0");
    });
  };

  return (
    <div
      className="flex flex-col md:flex-row md:items-center gap-3"
      aria-busy={isPending}
    >
      <form onSubmit={onSearchSubmit} className="flex-1">
        <label className="relative block">
          <span className="sr-only">반명 또는 강사명 검색</span>
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[color:var(--text-dim)]"
            strokeWidth={1.75}
            aria-hidden
          />
          <input
            name="q"
            type="search"
            defaultValue={q}
            placeholder="반명 또는 강사명 검색"
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

      <select
        aria-label="과목 선택"
        value={subject}
        onChange={(e) => onSubjectChange(e.target.value)}
        className="
          h-10 min-w-32 rounded-lg px-3
          bg-white border border-[color:var(--border)]
          text-[15px] text-[color:var(--text)]
          focus:outline-none focus:border-[color:var(--border-strong)]
          cursor-pointer
        "
      >
        {SUBJECT_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s === "전체" ? "전체 과목" : s}
          </option>
        ))}
      </select>

      <label
        className="
          inline-flex items-center gap-2 h-10 px-3 rounded-lg
          bg-white border border-[color:var(--border)]
          text-[14px] text-[color:var(--text-muted)]
          hover:text-[color:var(--text)] hover:bg-[color:var(--bg-hover)]
          cursor-pointer transition-colors select-none
        "
      >
        <input
          type="checkbox"
          checked={includeInactive}
          onChange={toggleIncludeInactive}
          className="size-4 cursor-pointer accent-[color:var(--action)]"
        />
        미사용 포함
      </label>
    </div>
  );
}
