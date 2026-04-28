"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { Plus, Search } from "lucide-react";
import type { UserRole } from "@/types/database";
import { BRANCH_FILTER_OPTIONS as BRANCH_OPTIONS_MASTER } from "@/config/branches";
const ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "전체 권한" },
  { value: "master", label: "마스터" },
  { value: "admin", label: "관리자" },
  { value: "manager", label: "매니저" },
  { value: "viewer", label: "뷰어" },
];
const ACTIVE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "전체 상태" },
  { value: "true", label: "활성" },
  { value: "false", label: "비활성" },
];

interface Props {
  currentUserRole: UserRole;
  currentUserBranch: string;
}

/**
 * F4 · 계정 리스트 상단 툴바.
 *
 * - 좌측: 검색(form submit) + 권한·분원·상태 드롭다운(즉시 반영)
 * - 우측: "+ 계정 생성" 검정 CTA → /accounts/new
 *
 * 분원 드롭다운은 권한별 분기:
 *  - master  : 전체/대치/송도 자유 선택
 *  - admin   : 본인 분원만 표시 + disabled (URL 조작해도 페이지에서 강제 덮어씀)
 *
 * 상태는 URL `?q=`, `?role=`, `?branch=`, `?active=` 로 동기화. 변경 시 page=1 리셋.
 */
export function AccountsToolbar({
  currentUserRole,
  currentUserBranch,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const q = searchParams.get("q") ?? "";
  const role = searchParams.get("role") ?? "";
  // admin 은 본인 분원 고정 표시
  const branch =
    currentUserRole === "admin"
      ? currentUserBranch
      : (searchParams.get("branch") ?? "전체");
  const active = searchParams.get("active") ?? "";

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

  const onRoleChange = (value: string) => {
    updateParams((p) => {
      if (value) p.set("role", value);
      else p.delete("role");
    });
  };

  const onBranchChange = (value: string) => {
    updateParams((p) => {
      if (!value || value === "전체") p.delete("branch");
      else p.set("branch", value);
    });
  };

  const onActiveChange = (value: string) => {
    updateParams((p) => {
      if (value === "true" || value === "false") p.set("active", value);
      else p.delete("active");
    });
  };

  return (
    <div
      className="flex flex-col md:flex-row md:flex-wrap md:items-center gap-3"
      aria-busy={isPending}
    >
      <form onSubmit={onSearchSubmit} className="flex-1 min-w-60">
        <label className="relative block">
          <span className="sr-only">이름·이메일 검색</span>
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[color:var(--text-dim)]"
            strokeWidth={1.75}
            aria-hidden
          />
          <input
            name="q"
            type="search"
            defaultValue={q}
            placeholder="이름·이메일 검색"
            className="
              w-full h-11 rounded-lg
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
        aria-label="권한 선택"
        value={role}
        onChange={(e) => onRoleChange(e.target.value)}
        className="
          h-11 min-w-36 rounded-lg px-3
          bg-white border border-[color:var(--border)]
          text-[15px] text-[color:var(--text)]
          focus:outline-none focus:border-[color:var(--border-strong)]
          cursor-pointer
        "
      >
        {ROLE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <select
        aria-label="분원 선택"
        value={branch}
        disabled={currentUserRole === "admin"}
        title={
          currentUserRole === "admin"
            ? "관리자는 본인 분원만 조회할 수 있습니다"
            : undefined
        }
        onChange={(e) => onBranchChange(e.target.value)}
        className="
          h-11 min-w-36 rounded-lg px-3
          bg-white border border-[color:var(--border)]
          text-[15px] text-[color:var(--text)]
          focus:outline-none focus:border-[color:var(--border-strong)]
          disabled:bg-[color:var(--bg-muted)] disabled:text-[color:var(--text-muted)]
          disabled:cursor-not-allowed
          cursor-pointer
        "
      >
        {currentUserRole === "admin" ? (
          <option value={currentUserBranch}>{currentUserBranch}</option>
        ) : (
          BRANCH_OPTIONS_MASTER.map((b) => (
            <option key={b} value={b}>
              {b === "전체" ? "전체 분원" : b}
            </option>
          ))
        )}
      </select>

      <select
        aria-label="활성 상태 선택"
        value={active}
        onChange={(e) => onActiveChange(e.target.value)}
        className="
          h-11 min-w-32 rounded-lg px-3
          bg-white border border-[color:var(--border)]
          text-[15px] text-[color:var(--text)]
          focus:outline-none focus:border-[color:var(--border-strong)]
          cursor-pointer
        "
      >
        {ACTIVE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <Link
        href="/accounts/new"
        className="
          inline-flex items-center justify-center gap-1.5
          h-11 px-4 rounded-lg
          bg-[color:var(--action)] text-[color:var(--action-text)]
          text-[14px] font-medium
          hover:bg-[color:var(--action-hover)]
          transition-colors shrink-0
        "
      >
        <Plus className="size-4" strokeWidth={2} aria-hidden />
        계정 생성
      </Link>
    </div>
  );
}
