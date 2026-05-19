"use client";

/**
 * 사이드바 분원 switcher (master 전용).
 *
 * - master 가 현재 보고 있는 분원을 한 번에 전환.
 * - "전체" + 4분원 dropdown.
 * - 선택 시 selectBranchAction 호출 → cookie 갱신 → router.refresh() 로
 *   서버 컴포넌트들 재렌더 (페이지 default branch 도 새 cookie 따라감).
 *
 * 비-master 사용자에게는 부모(Sidebar)가 단순 텍스트 표시 — 본 컴포넌트
 * 자체는 master 만 마운트.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Building2, Check } from "lucide-react";
import { selectBranchAction } from "@/app/(features)/(auth)/actions";
import { useToast } from "@/components/ui/toast";

interface Props {
  /** 현재 cookie 값 — null 이면 "전체". */
  current: string | null;
  branches: string[];
}

export function SidebarBranchSwitcher({ current, branches }: Props) {
  const router = useRouter();
  const { show: showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const currentLabel = current ?? "전체";

  const handleSelect = (value: string) => {
    setOpen(false);
    if (value === currentLabel) return;
    startTransition(async () => {
      const formData = new FormData();
      formData.set("branch", value);
      const result = await selectBranchAction(formData);
      if (result.status === "success") {
        showToast(
          "success",
          value === "전체"
            ? "전체 분원으로 전환했어요"
            : `'${value}' 분원으로 전환했어요`,
        );
        router.refresh();
      } else {
        showToast("error", "분원 전환에 실패했어요. 다시 시도해 주세요.");
      }
    });
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="
          flex items-center gap-2 w-full h-10 px-3 rounded-lg
          border border-[color:var(--border)]
          bg-[color:var(--bg-card)]
          hover:bg-[color:var(--bg-hover)]
          text-left text-[14px] text-[color:var(--text)]
          transition-colors
          disabled:opacity-60 disabled:cursor-not-allowed
        "
      >
        <Building2
          className="size-4 text-[color:var(--text-muted)] shrink-0"
          strokeWidth={1.75}
          aria-hidden
        />
        <span className="flex-1 truncate">
          분원: <span className="font-medium">{currentLabel}</span>
        </span>
        <ChevronDown
          className={`size-4 text-[color:var(--text-muted)] shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
          aria-hidden
        />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="분원 선택"
          className="
            absolute top-full mt-1 left-0 right-0 z-20
            rounded-lg border border-[color:var(--border)]
            bg-[color:var(--bg-card)]
            shadow-lg
            py-1
          "
        >
          {["전체", ...branches].map((b) => {
            const active = b === currentLabel;
            return (
              <li key={b}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => handleSelect(b)}
                  className="
                    flex items-center justify-between w-full h-9 px-3
                    text-left text-[14px] text-[color:var(--text)]
                    hover:bg-[color:var(--bg-hover)]
                    transition-colors
                  "
                >
                  <span className={active ? "font-medium" : ""}>{b}</span>
                  {active && (
                    <Check
                      className="size-4 text-[color:var(--text)]"
                      strokeWidth={2}
                      aria-hidden
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
