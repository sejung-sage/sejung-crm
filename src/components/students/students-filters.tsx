"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { Search, X, Eye, Check } from "lucide-react";
import type { Grade, SchoolLevel } from "@/types/database";
import { BRANCH_FILTER_OPTIONS } from "@/config/branches";
import { STUDENT_SORT_VALUES, type StudentSort } from "@/lib/schemas/student";
import { MultiSelectDropdown } from "@/components/shell/multi-select-dropdown";

/**
 * 학년·학교급 필터 옵션 (0012 정규화 enum 9종 대응).
 *
 * - LEVEL_SEGMENTS: 단일 선택 세그먼티드 컨트롤. '기타' 학생은 노이즈가 커서
 *   세그먼트에 노출하지 않음. '졸업·미정 포함 보기' 토글로 우회 노출.
 * - GRADE_OPTIONS_*: school_level 선택값에 따라 동적으로 보여줌.
 */
const LEVEL_SEGMENTS: ReadonlyArray<{
  value: SchoolLevel | "전체";
  label: string;
}> = [
  { value: "전체", label: "전체" },
  { value: "고", label: "고등" },
  { value: "중", label: "중등" },
];

const GRADE_OPTIONS_HIGH: ReadonlyArray<Grade> = ["고1", "고2", "고3", "재수"];
const GRADE_OPTIONS_MID: ReadonlyArray<Grade> = ["중1", "중2", "중3"];
// 학년 칩은 학교급과 무관하게 항상 7종 노출. 학교급 세그먼트는 school_level 필터로만 작용.
const GRADE_OPTIONS_ALL: ReadonlyArray<Grade> = [
  ...GRADE_OPTIONS_MID,
  ...GRADE_OPTIONS_HIGH,
];

const TRACK_OPTIONS = ["문과", "이과"] as const;
const STATUS_OPTIONS = ["재원생", "수강이력자", "신규리드", "탈퇴"] as const;
const SUBJECT_OPTIONS = ["수학", "국어", "영어", "탐구"] as const;

/**
 * 정렬 enum → 한글 라벨 매핑.
 * STUDENT_SORT_VALUES 와 동기화 필수 — 누락 시 컴파일 오류 (Record<StudentSort, ...>).
 */
const SORT_LABELS: Record<StudentSort, string> = {
  registered_desc: "최근 등록순",
  registered_asc: "오래된 등록순",
  name_asc: "이름 가나다순",
  name_desc: "이름 가나다 역순",
  attendance_desc: "출석률 높은 순",
  attendance_asc: "출석률 낮은 순 (케어)",
  enrollment_count_desc: "수강 많은 순",
  total_paid_desc: "누적 결제 많은 순",
};

const SORT_WHITELIST: ReadonlySet<string> = new Set(STUDENT_SORT_VALUES);

/**
 * 학생 목록 상단 검색·필터 바 (Client Component).
 * 상태는 URL query 로만 관리. 필터 변경 시 페이지는 1로 리셋.
 *
 * 검색창은 form submit 으로 동작 (debounce 없이) · 노안 사용자 배려.
 * 학년/계열/상태/과목 칩과 토글은 즉시 반영.
 *
 * 0012 마이그레이션 대응:
 *  - ?level=중|고  : 단일 학교급 (세그먼티드).
 *  - ?grade=중1..  : 학년 9종 enum (다중).
 *  - ?include_hidden=1 : 졸업·미정 포함 토글.
 *
 * 확장 필터:
 *  - ?subject=수학&subject=국어   : 수강 과목 (다중 칩)
 *  - ?teacher=A&teacher=B         : 강사명 (드롭다운에서 다중 선택 → 칩 표시)
 *  - ?school=대치고&school=휘문고 : 학교명 (combobox 검색 → 칩 표시)
 *  - ?sort=attendance_asc         : 정렬 단일 키 (기본 registered_desc)
 */
export function StudentsFilters({
  totalCount,
  source,
  teacherOptions,
  schoolOptions,
}: {
  totalCount: number;
  source: "supabase" | "dev-seed";
  /** 부모(Server Component) 가 prefetch 해서 넘겨주는 강사·학교 후보. */
  teacherOptions: string[];
  schoolOptions: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const q = searchParams.get("q") ?? "";
  const branch = searchParams.get("branch") ?? "전체";
  const grades = searchParams.getAll("grade");
  const tracks = searchParams.getAll("track");
  const statuses = searchParams.getAll("status");
  const subjects = searchParams.getAll("subject");
  const teachers = searchParams.getAll("teacher");
  const schools = searchParams.getAll("school");
  // school_level 은 운영 단순화를 위해 단일 선택 (배열 첫 값만 사용).
  const levelRaw = searchParams.getAll("level");
  const level: SchoolLevel | "전체" =
    levelRaw[0] === "중" || levelRaw[0] === "고" ? levelRaw[0] : "전체";
  const includeHidden = searchParams.get("include_hidden") === "1";

  const sortRaw = searchParams.get("sort");
  const sort: StudentSort =
    sortRaw && SORT_WHITELIST.has(sortRaw)
      ? (sortRaw as StudentSort)
      : "registered_desc";

  const updateParams = useCallback(
    (mutator: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams.toString());
      mutator(next);
      // 필터 변경 시 페이지 1 로 리셋
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

  /** 다중 토글 — grade/track/status/subject 공통. */
  const toggleValue = (
    key: "grade" | "track" | "status" | "subject",
    value: string,
  ) => {
    updateParams((p) => {
      const all = p.getAll(key);
      p.delete(key);
      if (all.includes(value)) {
        for (const v of all) if (v !== value) p.append(key, v);
      } else {
        for (const v of all) p.append(key, v);
        p.append(key, value);
      }
    });
  };

  /**
   * 다중 키(teacher/school) 의 단일 값 추가/제거.
   * 칩 X 버튼·드롭다운 체크박스에서 공유.
   */
  const toggleMulti = (key: "teacher" | "school", value: string) => {
    updateParams((p) => {
      const all = p.getAll(key);
      p.delete(key);
      if (all.includes(value)) {
        for (const v of all) if (v !== value) p.append(key, v);
      } else {
        for (const v of all) p.append(key, v);
        p.append(key, value);
      }
    });
  };

  const setBranch = (value: string) => {
    updateParams((p) => {
      if (value === "전체") p.delete("branch");
      else p.set("branch", value);
      // 분원이 바뀌면 강사·학교 옵션 풀이 달라지므로 선택 초기화.
      p.delete("teacher");
      p.delete("school");
    });
  };

  const setLevel = (value: SchoolLevel | "전체") => {
    updateParams((p) => {
      if (value === "전체") p.delete("level");
      else p.set("level", value);
    });
  };

  const setSort = (value: StudentSort) => {
    updateParams((p) => {
      if (value === "registered_desc") p.delete("sort");
      else p.set("sort", value);
    });
  };

  const toggleIncludeHidden = () => {
    updateParams((p) => {
      if (includeHidden) p.delete("include_hidden");
      else p.set("include_hidden", "1");
    });
  };

  const hasActiveFilters =
    q !== "" ||
    branch !== "전체" ||
    level !== "전체" ||
    grades.length > 0 ||
    tracks.length > 0 ||
    statuses.length > 0 ||
    subjects.length > 0 ||
    teachers.length > 0 ||
    schools.length > 0 ||
    includeHidden;

  const clearAll = () => {
    updateParams((p) => {
      p.delete("q");
      p.delete("branch");
      p.delete("level");
      p.delete("grade");
      p.delete("track");
      p.delete("status");
      p.delete("subject");
      p.delete("teacher");
      p.delete("school");
      p.delete("include_hidden");
      // 정렬은 의도적으로 유지 — 사용자가 명시적으로 바꾼 보기 옵션.
    });
  };

  const resultSummary = useMemo(
    () => `총 ${totalCount.toLocaleString()}명`,
    [totalCount],
  );

  return (
    <div className="space-y-4" aria-busy={isPending}>
      {/* 상단: 검색 + 분원 + 학교급 세그먼티드 + 정렬 */}
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <form onSubmit={onSearchSubmit} className="flex-1">
          <label className="relative block">
            <span className="sr-only">이름, 학교, 학부모 연락처 검색</span>
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[color:var(--text-dim)]"
              strokeWidth={1.75}
              aria-hidden
            />
            <input
              name="q"
              type="search"
              defaultValue={q}
              placeholder="이름, 학교, 학부모 연락처 검색"
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
          onChange={(e) => setBranch(e.target.value)}
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

        <SegmentedControl
          ariaLabel="학교급 선택"
          value={level}
          options={LEVEL_SEGMENTS}
          onChange={setLevel}
        />

        <select
          aria-label="정렬 기준"
          value={sort}
          onChange={(e) => setSort(e.target.value as StudentSort)}
          className="
            h-10 min-w-44 rounded-lg px-3
            bg-white border border-[color:var(--border)]
            text-[15px] text-[color:var(--text)]
            focus:outline-none focus:border-[color:var(--border-strong)]
            cursor-pointer
          "
        >
          {STUDENT_SORT_VALUES.map((v) => (
            <option key={v} value={v}>
              {SORT_LABELS[v]}
            </option>
          ))}
        </select>
      </div>

      {/* 학년 칩 + 졸업·미정 토글 */}
      <div className="flex flex-wrap gap-x-6 gap-y-3 items-center pt-1">
        <FilterGroup label="학년">
          {GRADE_OPTIONS_ALL.map((g) => (
            <Chip
              key={g}
              label={g}
              active={grades.includes(g)}
              onClick={() => toggleValue("grade", g)}
            />
          ))}
        </FilterGroup>

        {/* 졸업·미정 포함 토글 */}
        <button
          type="button"
          onClick={toggleIncludeHidden}
          aria-pressed={includeHidden}
          className={`
            inline-flex items-center gap-1.5 h-8 px-3 rounded-full
            text-[13px] font-medium
            border transition-colors
            ${
              includeHidden
                ? "bg-[color:var(--bg-hover)] text-[color:var(--text)] border-[color:var(--border-strong)]"
                : "bg-white text-[color:var(--text-muted)] border-[color:var(--border)] hover:text-[color:var(--text)] hover:bg-[color:var(--bg-hover)]"
            }
          `}
        >
          <Eye className="size-3.5" strokeWidth={1.75} aria-hidden />
          졸업·미정 포함 보기
        </button>
      </div>

      {/* 과목 + 계열 + 재원 상태 칩 */}
      <div className="flex flex-wrap gap-x-6 gap-y-3 items-start pt-1">
        <FilterGroup label="과목">
          {SUBJECT_OPTIONS.map((s) => (
            <Chip
              key={s}
              label={s}
              active={subjects.includes(s)}
              onClick={() => toggleValue("subject", s)}
            />
          ))}
        </FilterGroup>

        <FilterGroup label="계열">
          {TRACK_OPTIONS.map((t) => (
            <Chip
              key={t}
              label={t}
              active={tracks.includes(t)}
              onClick={() => toggleValue("track", t)}
            />
          ))}
        </FilterGroup>

        <FilterGroup label="재원 상태">
          {STATUS_OPTIONS.map((s) => (
            <Chip
              key={s}
              label={s}
              active={statuses.includes(s)}
              onClick={() => toggleValue("status", s)}
            />
          ))}
        </FilterGroup>
      </div>

      {/* 강사 + 학교 (드롭다운/콤보박스 + 선택 칩) */}
      <div className="flex flex-wrap gap-x-6 gap-y-3 items-start pt-1">
        <FilterGroup label="강사">
          <MultiSelectDropdown
            label="강사 선택"
            options={teacherOptions}
            selected={teachers}
            onToggle={(v) => toggleMulti("teacher", v)}
            emptyHint={
              teacherOptions.length === 0
                ? "선택 가능한 강사가 없습니다"
                : undefined
            }
          />
          {teachers.map((t) => (
            <SelectedChip
              key={t}
              label={t}
              onRemove={() => toggleMulti("teacher", t)}
            />
          ))}
        </FilterGroup>

        <FilterGroup label="학교">
          <ComboboxMulti
            placeholder="학교 검색"
            options={schoolOptions}
            selected={schools}
            onToggle={(v) => toggleMulti("school", v)}
          />
          {schools.map((s) => (
            <SelectedChip
              key={s}
              label={s}
              onRemove={() => toggleMulti("school", s)}
            />
          ))}
        </FilterGroup>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearAll}
            className="
              inline-flex items-center gap-1 h-8 px-2 rounded-md
              text-[13px] text-[color:var(--text-muted)]
              hover:text-[color:var(--text)]
              hover:bg-[color:var(--bg-hover)]
              transition-colors ml-auto
            "
          >
            <X className="size-3.5" strokeWidth={1.75} aria-hidden />
            필터 초기화
          </button>
        )}
      </div>

      {/* 결과 수 안내 */}
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-[color:var(--text-muted)]">
          {resultSummary}
          {source === "dev-seed" && (
            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full bg-[color:var(--warning-bg)] text-[color:var(--warning)] text-[12px]">
              개발용 시드 데이터
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center flex-wrap gap-2">
      <span className="text-[13px] font-medium text-[color:var(--text-muted)] shrink-0">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`
        inline-flex items-center h-8 px-3 rounded-full
        text-[14px] font-medium
        border transition-colors
        ${
          active
            ? "bg-[color:var(--action)] text-[color:var(--action-text)] border-[color:var(--action)]"
            : "bg-white text-[color:var(--text)] border-[color:var(--border)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--bg-hover)]"
        }
      `}
    >
      {label}
    </button>
  );
}

/**
 * 선택된 강사·학교를 보여주는 칩. 우측 X 로 단일 제거.
 * 토글 패턴은 같지만 시각적으로 검정 배경이 너무 무거우므로 흰 배경 + 보더 + X.
 */
function SelectedChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span
      className="
        inline-flex items-center gap-1 h-8 pl-3 pr-1 rounded-full
        text-[14px] font-medium
        bg-[color:var(--bg-muted)] text-[color:var(--text)]
        border border-[color:var(--border)]
      "
    >
      <span className="truncate max-w-[12rem]">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`${label} 제거`}
        className="
          inline-flex items-center justify-center
          size-6 rounded-full
          text-[color:var(--text-muted)]
          hover:text-[color:var(--text)]
          hover:bg-[color:var(--bg-hover)]
          transition-colors
        "
      >
        <X className="size-3.5" strokeWidth={1.75} aria-hidden />
      </button>
    </span>
  );
}

/**
 * 단일 선택 세그먼티드 컨트롤.
 * 인접 버튼이 단일 그룹처럼 보이게 첫·끝 라디우스만 적용.
 */
function SegmentedControl<T extends string>({
  ariaLabel,
  value,
  options,
  onChange,
}: {
  ariaLabel: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex h-10 rounded-lg border border-[color:var(--border)] bg-white p-0.5"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={`
              inline-flex items-center justify-center
              min-w-16 h-9 px-3 rounded-md
              text-[14px] font-medium
              transition-colors
              ${
                active
                  ? "bg-[color:var(--action)] text-[color:var(--action-text)]"
                  : "text-[color:var(--text-muted)] hover:text-[color:var(--text)] hover:bg-[color:var(--bg-hover)]"
              }
            `}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 검색 가능한 멀티 선택 콤보박스.
 * 학교 필터용. 옵션이 100개+ 가능하므로 키워드 필터 필수.
 *
 * - 인풋에 키워드 입력 → 옵션 필터 (대소문자 무관, 부분 일치)
 * - Enter: 첫 후보를 토글
 * - 외부 클릭 / Esc 닫힘
 * - 선택은 즉시 URL 반영, 드롭다운은 열린 상태 유지 (연속 선택 편의)
 */
function ComboboxMulti({
  placeholder,
  options,
  selected,
  onToggle,
}: {
  placeholder: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setKeyword("");
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setKeyword("");
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return options.slice(0, 200); // 너무 긴 목록은 위에서 자름
    return options
      .filter((o) => o.toLowerCase().includes(q))
      .slice(0, 200);
  }, [keyword, options]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = filtered[0];
      if (first) onToggle(first);
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      {!open ? (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            // 다음 틱에 포커스 (요소 마운트 후)
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
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
          <Search className="size-3.5" strokeWidth={1.75} aria-hidden />
          <span>+ {placeholder}</span>
        </button>
      ) : (
        <div
          className="
            inline-flex items-center gap-1.5 h-8 pl-3 pr-1 rounded-full
            bg-white
            border border-[color:var(--border-strong)]
          "
        >
          <Search
            className="size-3.5 text-[color:var(--text-dim)]"
            strokeWidth={1.75}
            aria-hidden
          />
          <input
            ref={inputRef}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={placeholder}
            className="
              w-40 bg-transparent
              text-[14px] text-[color:var(--text)]
              placeholder:text-[color:var(--text-dim)]
              focus:outline-none
            "
            aria-label={placeholder}
          />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setKeyword("");
            }}
            aria-label="검색 닫기"
            className="
              inline-flex items-center justify-center
              size-6 rounded-full
              text-[color:var(--text-muted)]
              hover:text-[color:var(--text)]
              hover:bg-[color:var(--bg-hover)]
              transition-colors
            "
          >
            <X className="size-3.5" strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      )}

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="
            absolute left-0 top-full mt-2 z-30
            min-w-64 max-w-80
            max-h-72 overflow-y-auto
            rounded-lg
            bg-white border border-[color:var(--border)]
            shadow-md
            p-1
          "
        >
          {options.length === 0 ? (
            <p className="px-3 py-2 text-[13px] text-[color:var(--text-muted)]">
              선택 가능한 학교가 없습니다
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-2 text-[13px] text-[color:var(--text-muted)]">
              일치하는 학교가 없습니다
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
                          : "bg-white border-[color:var(--border-strong)]"
                      }
                    `}
                    aria-hidden
                  >
                    {active && (
                      <Check className="size-3" strokeWidth={2.5} />
                    )}
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
