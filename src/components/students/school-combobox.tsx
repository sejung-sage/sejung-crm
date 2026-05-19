"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, Check, X } from "lucide-react";

/**
 * 학교명 자동완성 콤보박스.
 *
 * 동작:
 *   - 입력칸 클릭 또는 화살표 클릭 → 드롭다운 펼침
 *   - 검색창에 키워드 입력 → 옵션 substring 필터
 *   - 옵션 클릭 → value 반영 + 드롭다운 닫힘
 *   - 자유 입력 허용 — 옵션에 없는 학교명도 입력칸에 직접 타이핑하면 그대로 저장
 *   - ESC / 바깥 클릭 → 닫힘
 *
 * 디자인: 흰색+검정 미니멀. 학생 명단 학교 그룹 패널과 동일 톤.
 */
interface Props {
  /** 폼 데이터 추출용 input name. */
  name: string;
  /** 학교명 옵션 풀 (한글 정렬 distinct). */
  options: string[];
  /** 입력 초기값. */
  defaultValue?: string;
  placeholder?: string;
  inputClassName?: string;
  /** 옵션 미선택·자유입력만 허용할지. (지금은 둘 다 허용 — false default) */
  strict?: boolean;
}

export function SchoolCombobox({
  name,
  options,
  defaultValue = "",
  placeholder = "예: 휘문고",
  inputClassName,
  strict = false,
}: Props) {
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 바깥 클릭 / ESC 로 닫기.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // 열렸을 때 검색 input 에 자동 포커스.
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim();
    if (q.length === 0) return options.slice(0, 200);
    const qNorm = q.toLowerCase();
    return options
      .filter((opt) => opt.toLowerCase().includes(qNorm))
      .slice(0, 200);
  }, [search, options]);

  const handleSelect = (opt: string) => {
    setValue(opt);
    setSearch("");
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      {/* 표시·자유입력 input */}
      <div className="flex items-stretch gap-0">
        <input
          name={name}
          type="text"
          value={value}
          onChange={(e) => {
            if (strict) return; // strict 모드면 직접 입력 차단 — 옵션 선택만.
            setValue(e.target.value);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          maxLength={50}
          autoComplete="off"
          className={
            inputClassName ??
            `w-full h-10 rounded-l-lg px-3
             bg-bg-card border border-r-0 border-[color:var(--border)]
             text-[15px] text-[color:var(--text)]
             placeholder:text-[color:var(--text-dim)]
             focus:outline-none focus:border-[color:var(--border-strong)]
             transition-colors`
          }
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label="학교 풀에서 선택"
          aria-haspopup="listbox"
          aria-expanded={open}
          className="
            inline-flex items-center justify-center
            h-10 w-10 rounded-r-lg
            bg-bg-card border border-[color:var(--border)]
            text-[color:var(--text-muted)]
            hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text)]
            focus:outline-none focus:border-[color:var(--border-strong)]
            transition-colors
          "
        >
          <ChevronDown
            className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
            strokeWidth={1.75}
            aria-hidden
          />
        </button>
      </div>

      {/* 드롭다운 패널 */}
      {open && (
        <div
          className="
            absolute left-0 right-0 top-full mt-2 z-30
            rounded-xl bg-bg-card border border-[color:var(--border)]
            shadow-md
            overflow-hidden
          "
        >
          {/* 검색창 */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[color:var(--border)]">
            <Search
              className="size-4 text-[color:var(--text-muted)] shrink-0"
              strokeWidth={1.75}
              aria-hidden
            />
            <input
              ref={inputRef}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="학교명 검색"
              className="
                flex-1 h-8 bg-transparent
                text-[14px] text-[color:var(--text)]
                placeholder:text-[color:var(--text-dim)]
                focus:outline-none
              "
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="검색 지우기"
                className="
                  inline-flex items-center justify-center size-6 rounded-md
                  text-[color:var(--text-muted)]
                  hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text)]
                "
              >
                <X className="size-3.5" strokeWidth={1.75} aria-hidden />
              </button>
            )}
          </div>

          {/* 옵션 리스트 */}
          <ul
            role="listbox"
            className="max-h-72 overflow-y-auto py-1"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-[13px] text-[color:var(--text-muted)]">
                일치하는 학교가 없어요. 직접 입력하셔도 돼요.
              </li>
            ) : (
              filtered.map((opt) => {
                const selected = opt === value;
                return (
                  <li key={opt}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => handleSelect(opt)}
                      className="
                        w-full flex items-center justify-between gap-2
                        px-3 py-2
                        text-left text-[14px] text-[color:var(--text)]
                        hover:bg-[color:var(--bg-hover)]
                        transition-colors
                      "
                    >
                      <span className="truncate">{opt}</span>
                      {selected && (
                        <Check
                          className="size-4 text-[color:var(--text)] shrink-0"
                          strokeWidth={2}
                          aria-hidden
                        />
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>

          {search.length > 0 && !filtered.includes(search) && (
            <div className="border-t border-[color:var(--border)] px-3 py-2">
              <button
                type="button"
                onClick={() => handleSelect(search.trim())}
                className="
                  w-full text-left text-[13px] text-[color:var(--text-muted)]
                  hover:text-[color:var(--text)]
                "
              >
                + 새 학교 &lsquo;{search.trim()}&rsquo; 그대로 사용
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
