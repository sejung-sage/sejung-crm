"use client";

import { ChevronDown, Check, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * 다중 선택 드롭다운 (체크박스형).
 *
 * 학생 리스트의 강사 필터에서 출발해, 강좌 리스트의 강사 필터에서도 동일하게
 * 사용하도록 `src/components/shell/` 로 승격된 공유 컴포넌트.
 * (참고 사례: `students/attendance-status-chip.tsx` 의 단일 소스 분리.)
 *
 * 정책:
 *  - 기본은 검색창 없음. `searchable=true` 인 경우 패널 상단에 in-memory
 *    부분일치 검색창을 노출 (강사처럼 옵션이 50~200개 단위일 때 활성화).
 *  - 외부 클릭 / Esc 로 닫힘. 선택은 즉시 onToggle 로 위임 (드롭다운은 열린 상태 유지).
 *  - URL 동기화·페이지 리셋 등 상태 관리는 호출부 책임.
 *
 * 디자인:
 *  - 트리거는 8px 높이의 점선 둥근 버튼 ("+ 강사 선택" 같은 라벨).
 *  - 패널은 흰 배경, 1px 보더, 작은 그림자. 보라색·강한 색 금지.
 */
export function MultiSelectDropdown({
  label,
  options,
  selected,
  onToggle,
  emptyHint,
  searchable = false,
  searchPlaceholder,
  onSelectAll,
  onClearAll,
}: {
  /** 트리거 버튼 라벨 ("강사 선택" 등). */
  label: string;
  /** 선택 가능한 후보 (이미 정렬된 상태로 받음). */
  options: string[];
  /** 현재 선택된 값. */
  selected: string[];
  /** 클릭 시 토글 이벤트 — 부모가 URL 등에 반영. */
  onToggle: (value: string) => void;
  /** 옵션 0개일 때 안내 문구. 미지정 시 기본 문구 사용. */
  emptyHint?: string;
  /** 패널 상단 검색창 노출 여부 (기본 false). */
  searchable?: boolean;
  /** 검색창 placeholder. searchable=true 일 때만 의미 있음. */
  searchPlaceholder?: string;
  /**
   * "전체 선택" 액션. 지정 시 패널 상단(옵션 목록 위)에 "전체 선택" 버튼 노출.
   * 인자는 **현재 드롭다운에 보이는(검색 적용된) 옵션**. 부모가 이 목록만
   * 일괄 선택한다. 미지정(기본)이면 버튼 자체가 렌더되지 않아 다른 사용처
   * (강사 선택 등)에는 영향이 없다.
   */
  onSelectAll?: (visibleOptions: string[]) => void;
  /**
   * "전체 해제" 액션. 지정 시 "전체 선택"과 함께 노출.
   * 인자는 현재 드롭다운에 보이는(검색 적용된) 옵션. 부모가 이 목록만 해제한다.
   */
  onClearAll?: (visibleOptions: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // 검색어 (in-memory 부분일치). 한글 입력은 그대로 includes 매칭.
  // - 옵션 200개 이내 가정. 그 이상이면 별도 컴포넌트로 분리 권장.
  // - 선택된 항목은 검색 결과 0개여도 항상 상단에 노출해 해제 가능하게 유지.
  const normalized = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!searchable || normalized.length === 0) return options;
    return options.filter((opt) => opt.toLowerCase().includes(normalized));
  }, [searchable, normalized, options]);

  // 열릴 때마다 검색어 초기화 (이전 검색 잔재 제거).
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="
          inline-flex items-center gap-1.5 h-8 px-3 rounded-full
          text-[14px] font-medium
          bg-bg-card text-[color:var(--text)]
          border border-dashed border-[color:var(--border-strong)]
          hover:bg-[color:var(--bg-hover)]
          transition-colors
        "
      >
        <span>+ {label}</span>
        <ChevronDown
          className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`}
          strokeWidth={1.75}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="
            absolute left-0 top-full mt-2 z-30
            min-w-64 max-w-80
            rounded-lg
            bg-bg-card border border-[color:var(--border)]
            shadow-md
            flex flex-col
          "
        >
          {searchable && (
            <div className="p-2 border-b border-[color:var(--border)]">
              <label className="relative block">
                <span className="sr-only">검색</span>
                <Search
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-[color:var(--text-dim)]"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={searchPlaceholder ?? `${label} 검색...`}
                  autoFocus
                  className="
                    w-full h-9 rounded-md
                    pl-8 pr-8
                    bg-bg-card border border-[color:var(--border)]
                    text-[13px] text-[color:var(--text)]
                    placeholder:text-[color:var(--text-dim)]
                    focus:outline-none focus:border-[color:var(--border-strong)]
                  "
                />
                {query.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="검색어 지우기"
                    className="
                      absolute right-1.5 top-1/2 -translate-y-1/2
                      inline-flex items-center justify-center size-5 rounded
                      text-[color:var(--text-muted)] hover:text-[color:var(--text)]
                      hover:bg-[color:var(--bg-hover)]
                    "
                  >
                    <X className="size-3.5" strokeWidth={1.75} aria-hidden />
                  </button>
                )}
              </label>
            </div>
          )}
          {(onSelectAll || onClearAll) && filtered.length > 0 && (
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[color:var(--border)]">
              {onSelectAll && (
                <button
                  type="button"
                  onClick={() => onSelectAll(filtered)}
                  className="
                    inline-flex items-center h-7 px-2 rounded-md
                    text-[12px] font-medium text-[color:var(--text)]
                    hover:bg-[color:var(--bg-hover)]
                    transition-colors
                  "
                >
                  {normalized.length > 0
                    ? `검색 결과 ${filtered.length}개 모두 선택`
                    : "전체 선택"}
                </button>
              )}
              {onClearAll && (
                <button
                  type="button"
                  onClick={() => onClearAll(filtered)}
                  className="
                    inline-flex items-center h-7 px-2 rounded-md
                    text-[12px] font-medium text-[color:var(--text-muted)]
                    hover:text-[color:var(--text)] hover:bg-[color:var(--bg-hover)]
                    transition-colors
                  "
                >
                  전체 해제
                </button>
              )}
            </div>
          )}
          <div className="max-h-64 overflow-y-auto p-1">
            {options.length === 0 ? (
              <p className="px-3 py-2 text-[13px] text-[color:var(--text-muted)]">
                {emptyHint ?? "옵션이 없습니다"}
              </p>
            ) : filtered.length === 0 ? (
              <p className="px-3 py-2 text-[13px] text-[color:var(--text-muted)]">
                일치하는 항목이 없습니다
              </p>
            ) : (
              filtered.map((opt) => {
                const active = selectedSet.has(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => onToggle(opt)}
                    className="
                      w-full flex items-center gap-2
                      px-2 py-2 rounded-md
                      text-left text-[14px]
                      text-[color:var(--text)]
                      hover:bg-[color:var(--bg-hover)]
                      transition-colors
                    "
                  >
                    <span
                      className={`
                        inline-flex items-center justify-center
                        size-4 rounded
                        border
                        ${
                          active
                            ? "bg-[color:var(--action)] border-[color:var(--action)] text-[color:var(--action-text)]"
                            : "bg-bg-card border-[color:var(--border-strong)]"
                        }
                      `}
                      aria-hidden
                    >
                      {active && <Check className="size-3" strokeWidth={2.5} />}
                    </span>
                    <span className="truncate">{opt}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
