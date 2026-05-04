"use client";

import { ChevronDown, Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * 다중 선택 드롭다운 (체크박스형).
 *
 * 학생 리스트의 강사 필터에서 출발해, 강좌 리스트의 강사 필터에서도 동일하게
 * 사용하도록 `src/components/shell/` 로 승격된 공유 컴포넌트.
 * (참고 사례: `students/attendance-status-chip.tsx` 의 단일 소스 분리.)
 *
 * 정책:
 *  - 옵션 ~수십 개 수준 가정 → 검색창 없음. 검색이 필요한 케이스(학교 등)는
 *    별도의 ComboboxMulti 를 사용.
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
}) {
  const [open, setOpen] = useState(false);
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
          bg-white text-[color:var(--text)]
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
            min-w-56 max-w-72
            max-h-72 overflow-y-auto
            rounded-lg
            bg-white border border-[color:var(--border)]
            shadow-md
            p-1
          "
        >
          {options.length === 0 ? (
            <p className="px-3 py-2 text-[13px] text-[color:var(--text-muted)]">
              {emptyHint ?? "옵션이 없습니다"}
            </p>
          ) : (
            options.map((opt) => {
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
                          : "bg-white border-[color:var(--border-strong)]"
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
      )}
    </div>
  );
}
