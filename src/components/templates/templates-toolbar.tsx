"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { Plus, Search } from "lucide-react";

interface Props {
  /**
   * @deprecated 0059 마이그에서 teacher_name 컬럼 삭제. 호출부 호환을 위해 시그니처는
   * 남겨두지만 더 이상 UI 에 노출하지 않는다. 다음 정리 시 prop 자체 제거 예정.
   */
  teachers?: string[];
}

/**
 * F3-01 · 템플릿 리스트 상단 툴바.
 *
 * - 좌: 검색(제목/본문) · 유형 드롭다운
 * - 우: "+ 새 템플릿" → /templates/new
 *
 * 상태는 URL `?q=`, `?type=` 로 동기화.
 *
 * 0059 마이그에서 강사 필터 제거 (templates.teacher_name 컬럼 삭제).
 * ALIMTALK 옵션도 제거 — 사전 등록 템플릿이 필요해 Phase 1 으로 보류.
 */
const TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "전체 유형" },
  { value: "SMS", label: "SMS" },
  { value: "LMS", label: "LMS" },
];

export function TemplatesToolbar(_props: Props) {
  // teachers prop 은 의도적으로 사용하지 않음 (deprecated).
  void _props;

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const q = searchParams.get("q") ?? "";
  const type = searchParams.get("type") ?? "";

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

      <select
        aria-label="유형 선택"
        value={type}
        onChange={(e) => onTypeChange(e.target.value)}
        className="
          h-10 min-w-36 rounded-lg px-3
          bg-bg-card border border-[color:var(--border)]
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
