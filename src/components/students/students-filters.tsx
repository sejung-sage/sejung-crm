"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useTransition } from "react";
import { Search, X, Eye } from "lucide-react";
import type { Grade, SchoolLevel } from "@/types/database";

const BRANCH_OPTIONS = ["전체", "대치", "송도"] as const;

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

/**
 * 학생 목록 상단 검색·필터 바 (Client Component).
 * 상태는 URL query 로만 관리. 필터 변경 시 페이지는 1로 리셋.
 *
 * 검색창은 form submit 으로 동작 (debounce 없이) · 노안 사용자 배려.
 * 학년/계열/상태 칩과 토글은 즉시 반영.
 *
 * 0012 마이그레이션 대응:
 *  - ?level=중|고  : 단일 학교급 (세그먼티드).
 *  - ?grade=중1..  : 학년 9종 enum (다중).
 *  - ?include_hidden=1 : 졸업·미정 포함 토글.
 */
export function StudentsFilters({
  totalCount,
  source,
}: {
  totalCount: number;
  source: "supabase" | "dev-seed";
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
  // school_level 은 운영 단순화를 위해 단일 선택 (배열 첫 값만 사용).
  const levelRaw = searchParams.getAll("level");
  const level: SchoolLevel | "전체" =
    levelRaw[0] === "중" || levelRaw[0] === "고" ? levelRaw[0] : "전체";
  const includeHidden = searchParams.get("include_hidden") === "1";

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

  const toggleValue = (key: "grade" | "track" | "status", value: string) => {
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
    });
  };

  const setLevel = (value: SchoolLevel | "전체") => {
    updateParams((p) => {
      if (value === "전체") p.delete("level");
      else p.set("level", value);
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
    includeHidden;

  const clearAll = () => {
    updateParams((p) => {
      p.delete("q");
      p.delete("branch");
      p.delete("level");
      p.delete("grade");
      p.delete("track");
      p.delete("status");
      p.delete("include_hidden");
    });
  };

  const resultSummary = useMemo(
    () => `총 ${totalCount.toLocaleString()}명`,
    [totalCount],
  );

  return (
    <div className="space-y-4" aria-busy={isPending}>
      {/* 상단: 검색 + 분원 + 학교급 세그먼티드 */}
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
          {BRANCH_OPTIONS.map((b) => (
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
      </div>

      {/* 학년 칩 */}
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

      {/* 계열·재원 상태 칩 */}
      <div className="flex flex-wrap gap-x-6 gap-y-3 items-start pt-1">
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
    <div className="flex items-center gap-2">
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
