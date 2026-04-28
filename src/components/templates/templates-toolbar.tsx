"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { Plus, Search } from "lucide-react";

interface Props {
  teachers: string[];
}

const TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "전체 유형" },
  { value: "SMS", label: "SMS" },
  { value: "LMS", label: "LMS" },
  { value: "ALIMTALK", label: "알림톡" },
];

/**
 * F3-01 · 템플릿 리스트 상단 툴바.
 *
 * - 좌: 검색(제목/본문) · 유형 드롭다운 · 강사 드롭다운
 * - 우: "+ 새 템플릿" → /templates/new
 *
 * 상태는 URL `?q=`, `?type=`, `?teacher_name=` 로 동기화.
 */
export function TemplatesToolbar({ teachers }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const q = searchParams.get("q") ?? "";
  const type = searchParams.get("type") ?? "";
  const teacherName = searchParams.get("teacher_name") ?? "";

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

  const onTypeChange = (value: string) => {
    updateParams((p) => {
      if (value) p.set("type", value);
      else p.delete("type");
    });
  };

  const onTeacherChange = (value: string) => {
    updateParams((p) => {
      if (value) p.set("teacher_name", value);
      else p.delete("teacher_name");
    });
  };

  return (
    <div
      className="flex flex-col md:flex-row md:items-center gap-3"
      aria-busy={isPending}
    >
      <form onSubmit={onSearchSubmit} className="flex-1">
        <label className="relative block">
          <span className="sr-only">템플릿 검색</span>
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[color:var(--text-dim)]"
            strokeWidth={1.75}
            aria-hidden
          />
          <input
            name="q"
            type="search"
            defaultValue={q}
            placeholder="템플릿명 또는 본문 검색"
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
        aria-label="유형 선택"
        value={type}
        onChange={(e) => onTypeChange(e.target.value)}
        className="
          h-10 min-w-36 rounded-lg px-3
          bg-white border border-[color:var(--border)]
          text-[15px] text-[color:var(--text)]
          focus:outline-none focus:border-[color:var(--border-strong)]
          cursor-pointer
        "
      >
        {TYPE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <select
        aria-label="강사 선택"
        value={teacherName}
        onChange={(e) => onTeacherChange(e.target.value)}
        className="
          h-10 min-w-36 rounded-lg px-3
          bg-white border border-[color:var(--border)]
          text-[15px] text-[color:var(--text)]
          focus:outline-none focus:border-[color:var(--border-strong)]
          cursor-pointer
        "
      >
        <option value="">전체 강사</option>
        {teachers.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      <Link
        href="/templates/new"
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
        새 템플릿
      </Link>
    </div>
  );
}
