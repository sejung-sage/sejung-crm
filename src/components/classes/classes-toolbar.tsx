"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { Search, X } from "lucide-react";

import { BRANCH_FILTER_OPTIONS } from "@/config/branches";
import {
  CLASS_DAY_VALUES,
  CLASS_SORT_VALUES,
  type ClassDay,
  type ClassSort,
} from "@/lib/schemas/class";
import { MultiSelectDropdown } from "@/components/shell/multi-select-dropdown";

/**
 * F0 · 강좌 리스트 상단 툴바.
 *
 * - 1행(검색·드롭다운): 검색 + 분원 + 과목 + 정렬 + 미사용 토글
 * - 2행(요일 칩): 월~일 7종 다중 토글 (학생 리스트 학년 칩 패턴 미러)
 * - 3행(강사 + 초기화): 강사 다중 선택 드롭다운 + 선택 칩 + 필터 초기화
 *
 * 상태는 URL 로 동기화. 학생 리스트 `students-filters.tsx` 와 동일 패턴:
 *  - ?q=...                          : 검색
 *  - ?branch=대치                     : 분원
 *  - ?subject=수학                    : 과목
 *  - ?teacher=A&teacher=B             : 강사 (다중)
 *  - ?day=월&day=수                   : 요일 (다중)
 *  - ?sort=enrolled_count_desc        : 정렬 (단일)
 *  - ?active=0                        : 미사용 강좌 포함
 *
 * 분원 변경 시 강사 선택은 자동 초기화 (분원이 바뀌면 강사 풀이 달라지므로).
 * 필터 변경 시 page 는 항상 1 로 리셋.
 */

const SUBJECT_OPTIONS = ["전체", "수학", "국어", "영어", "탐구"] as const;

/**
 * 정렬 enum → 한글 라벨 매핑.
 * CLASS_SORT_VALUES 11종 동기화 필수 — 누락 시 컴파일 오류 (Record<ClassSort, ...>).
 *
 * enrolled_count_* 는 backend-dev 보고대로 페이지 한정 정렬 (DB 측 집계
 * 컬럼 부재). 사용자 혼동 방지를 위해 옵션 라벨 옆에 작은 muted 주석을 단다.
 */
const SORT_LABELS: Record<ClassSort, string> = {
  default: "기본 정렬 (분원 > 과목 > 반명)",
  registered_desc: "최근 등록순",
  registered_asc: "오래된 등록순",
  name_asc: "반명 가나다순",
  name_desc: "반명 가나다 역순",
  enrolled_count_desc: "수강생 많은 순 (현재 페이지 내 정렬)",
  enrolled_count_asc: "수강생 적은 순 / 정원 미달 (현재 페이지 내 정렬)",
  capacity_desc: "정원 많은 순",
  amount_per_session_desc: "회당단가 높은 순",
  amount_per_session_asc: "회당단가 낮은 순",
  total_sessions_desc: "총회차 많은 순",
};

const SORT_WHITELIST: ReadonlySet<string> = new Set(CLASS_SORT_VALUES);
const DAY_WHITELIST: ReadonlySet<string> = new Set(CLASS_DAY_VALUES);

interface Props {
  /** 부모(Server Component) 가 prefetch 해서 넘겨주는 강사 후보. */
  teacherOptions: string[];
}

export function ClassesToolbar({ teacherOptions }: Props) {
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

  // 다중 키 — 반복 파라미터 (?teacher=A&teacher=B, ?day=월&day=수).
  const teachers = searchParams.getAll("teacher");
  const days = searchParams
    .getAll("day")
    .filter((d): d is ClassDay => DAY_WHITELIST.has(d));

  // active 의 기본은 true (미사용 숨김). ?active=0 이면 미사용 포함(체크됨).
  const includeInactive = searchParams.get("active") === "0";

  const sortRaw = searchParams.get("sort");
  const sort: ClassSort =
    sortRaw && SORT_WHITELIST.has(sortRaw)
      ? (sortRaw as ClassSort)
      : "default";

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

  const onBranchChange = (value: string) => {
    updateParams((p) => {
      if (value === "전체") p.delete("branch");
      else p.set("branch", value);
      // 분원이 바뀌면 강사 옵션 풀이 달라지므로 선택 초기화 — 학생 리스트와 동일.
      p.delete("teacher");
    });
  };

  const onSubjectChange = (value: string) => {
    updateParams((p) => {
      if (value === "전체") p.delete("subject");
      else p.set("subject", value);
    });
  };

  const onSortChange = (value: ClassSort) => {
    updateParams((p) => {
      if (value === "default") p.delete("sort");
      else p.set("sort", value);
    });
  };

  const toggleIncludeInactive = () => {
    updateParams((p) => {
      if (includeInactive) p.delete("active");
      else p.set("active", "0");
    });
  };

  /** 다중 키(teacher/day) 의 단일 값 추가/제거. 학생 리스트의 toggleMulti 미러. */
  const toggleMulti = (key: "teacher" | "day", value: string) => {
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

  const hasActiveFilters =
    q !== "" ||
    branch !== "전체" ||
    subject !== "전체" ||
    teachers.length > 0 ||
    days.length > 0 ||
    includeInactive;

  const clearAll = () => {
    updateParams((p) => {
      p.delete("q");
      p.delete("branch");
      p.delete("subject");
      p.delete("teacher");
      p.delete("day");
      p.delete("active");
      // 정렬은 의도적으로 유지 — 사용자가 명시적으로 바꾼 보기 옵션.
    });
  };

  return (
    <div className="space-y-4" aria-busy={isPending}>
      {/* 1행: 검색 + 분원 + 과목 + 정렬 + 미사용 포함 */}
      <div className="flex flex-col md:flex-row md:items-center gap-3">
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

        <select
          aria-label="정렬 기준"
          value={sort}
          onChange={(e) => onSortChange(e.target.value as ClassSort)}
          className="
            h-10 min-w-44 rounded-lg px-3
            bg-white border border-[color:var(--border)]
            text-[15px] text-[color:var(--text)]
            focus:outline-none focus:border-[color:var(--border-strong)]
            cursor-pointer
          "
        >
          {CLASS_SORT_VALUES.map((v) => (
            <option key={v} value={v}>
              {SORT_LABELS[v]}
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

      {/* 2행: 요일 칩 (다중 토글) */}
      <div className="flex flex-wrap gap-x-6 gap-y-3 items-center pt-1">
        <FilterGroup label="요일">
          {CLASS_DAY_VALUES.map((d) => (
            <Chip
              key={d}
              label={d}
              active={days.includes(d)}
              onClick={() => toggleMulti("day", d)}
            />
          ))}
        </FilterGroup>
      </div>

      {/* 3행: 강사 (드롭다운 + 선택 칩) + 필터 초기화 */}
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
    </div>
  );
}

// ─── 내부 소 컴포넌트 ────────────────────────────────────────

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
 * 선택된 강사를 보여주는 칩. 우측 X 로 단일 제거.
 * 학생 리스트 SelectedChip 과 디자인 1:1 일치.
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
