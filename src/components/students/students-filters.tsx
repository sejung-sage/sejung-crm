"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useMemo,
  useState,
  useTransition,
} from "react";
import { Search, X, Eye, ChevronDown, Loader2 } from "lucide-react";
import type { Grade, SchoolLevel } from "@/types/database";
import { BRANCH_FILTER_OPTIONS } from "@/config/branches";
import { REGION_OPTIONS } from "@/config/regions";
import { STUDENT_SORT_VALUES, type StudentSort } from "@/lib/schemas/student";
import type { SchoolGroup } from "@/lib/profile/list-filter-options";

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
  { value: "초", label: "초등" },
];

const GRADE_OPTIONS_HIGH: ReadonlyArray<Grade> = ["고1", "고2", "고3", "재수"];
const GRADE_OPTIONS_MID: ReadonlyArray<Grade> = ["중1", "중2", "중3"];
const GRADE_OPTIONS_ELEM: ReadonlyArray<Grade> = ["초등"];
const GRADE_OPTIONS_ALL: ReadonlyArray<Grade> = [
  ...GRADE_OPTIONS_ELEM,
  ...GRADE_OPTIONS_MID,
  ...GRADE_OPTIONS_HIGH,
];

/**
 * 학교급(level) 별 노출 가능한 학년 칩 — 학교급-학년 정합성 강제.
 *  - 전체: 8종 모두
 *  - 초:   초등 1종
 *  - 중:   중1·중2·중3
 *  - 고:   고1·고2·고3·재수
 * 학교급 전환 시 부적합한 grade 는 setLevel 에서 자동 제거.
 */
function gradeOptionsForLevel(
  level: SchoolLevel | "전체",
): ReadonlyArray<Grade> {
  switch (level) {
    case "초":
      return GRADE_OPTIONS_ELEM;
    case "중":
      return GRADE_OPTIONS_MID;
    case "고":
      return GRADE_OPTIONS_HIGH;
    default:
      return GRADE_OPTIONS_ALL;
  }
}

const STATUS_OPTIONS = ["재원생", "수강이력자", "수강이력없음", "탈퇴"] as const;
// 지역 칩 옵션은 SSOT(src/config/regions.ts) 의 REGION_OPTIONS 사용.

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
 * 학년/상태/지역 칩과 토글은 즉시 반영.
 *
 * 0012 마이그레이션 대응:
 *  - ?level=중|고  : 단일 학교급 (세그먼티드).
 *  - ?grade=중1..  : 학년 9종 enum (다중).
 *  - ?include_hidden=1 : 졸업·미정 포함 토글.
 *
 * 확장 필터:
 *  - ?region=강남구&region=서초구 : 지역 (다중 칩, 5종 고정)
 *  - ?school=대치고&school=휘문고 : 학교명 (combobox 검색 → 칩 표시)
 *  - ?sort=attendance_asc         : 정렬 단일 키 (기본 registered_desc)
 */
export function StudentsFilters({
  totalCount,
  source,
  schoolGroups,
  canPickBranch,
}: {
  totalCount: number;
  source: "supabase" | "dev-seed";
  /**
   * 부모(Server Component) 가 prefetch 한 학교 후보를 5개 지역 그룹으로 묶은 결과.
   * 빈 그룹(해당 지역 학교 0개)도 포함될 수 있어 UI 에서 필터링.
   */
  schoolGroups: SchoolGroup[];
  /** master 만 분원 select 노출. 그 외는 사이드바 표시(분원: X)로 충분. */
  canPickBranch: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  // 학교 필터 패널의 펼침/접힘 (기본 접힘). 선택된 학교가 있으면 처음부터 펼침.
  const [schoolPanelOpen, setSchoolPanelOpen] = useState(false);

  const q = searchParams.get("q") ?? "";
  const branch = searchParams.get("branch") ?? "전체";
  const grades = searchParams.getAll("grade");
  // URL 에 ?status= 키 자체가 없으면 백엔드는 "재원생" default 적용 (조회 가속).
  // 칩 active 표시도 동일하게 맞춰서 UI 와 실 쿼리 일관성을 유지한다.
  const statusesFromUrl = searchParams.getAll("status");
  const statusKeyPresent = searchParams.has("status");
  const statuses = statusKeyPresent ? statusesFromUrl : ["재원생"];
  const regions = searchParams.getAll("region");
  const schools = searchParams.getAll("school");
  // school_level 은 운영 단순화를 위해 단일 선택 (배열 첫 값만 사용).
  const levelRaw = searchParams.getAll("level");
  const level: SchoolLevel | "전체" =
    levelRaw[0] === "초" ||
    levelRaw[0] === "중" ||
    levelRaw[0] === "고"
      ? levelRaw[0]
      : "전체";
  const includeHidden = searchParams.get("include_hidden") === "1";

  const sortRaw = searchParams.get("sort");
  const sort: StudentSort =
    sortRaw && SORT_WHITELIST.has(sortRaw)
      ? (sortRaw as StudentSort)
      : "registered_desc";

  const updateParams = useCallback(
    (mutator: (p: URLSearchParams) => void) => {
      // 최신 URL 을 직접 읽어 mutate — useSearchParams() 는 useTransition 중
      // 옛 snapshot 을 잠시 반환할 수 있어, 사용자가 빠르게 학년 칩을
      // 연속 토글하면 이전 클릭 결과가 누락되거나 누적되는 race 가 발생.
      // window.location.search 가 항상 최신.
      const sourceQuery =
        typeof window !== "undefined"
          ? window.location.search
          : `?${searchParams.toString()}`;
      const next = new URLSearchParams(sourceQuery);
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

  /** 다중 토글 — grade/status/region 공통. */
  const toggleValue = (
    key: "grade" | "status" | "region",
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
   * 다중 키(school) 의 단일 값 추가/제거.
   * 칩 X 버튼·콤보박스 옵션에서 공유.
   */
  const toggleMulti = (key: "school", value: string) => {
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
      // 분원이 바뀌면 학교 옵션 풀이 달라지므로 선택 초기화.
      p.delete("school");
    });
  };

  const setLevel = (value: SchoolLevel | "전체") => {
    updateParams((p) => {
      if (value === "전체") p.delete("level");
      else p.set("level", value);

      // 학교급-학년 정합성: 새 level 에 부적합한 grade 자동 제거.
      // 예: 중등 선택 시 grade=고1 같은 게 남아 있으면 결과가 0건이 되는
      //     이상한 조합 방지.
      const allowed = new Set<string>(gradeOptionsForLevel(value));
      const current = p.getAll("grade");
      p.delete("grade");
      for (const g of current) {
        if (allowed.has(g)) p.append("grade", g);
      }
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
    statuses.length > 0 ||
    regions.length > 0 ||
    schools.length > 0 ||
    includeHidden;

  const clearAll = () => {
    updateParams((p) => {
      p.delete("q");
      p.delete("branch");
      p.delete("level");
      p.delete("grade");
      p.delete("status");
      p.delete("region");
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
      {/* 필터 변경 중 전체 화면 dim + 스피너. App Router 의 같은 segment
          navigation (URL searchParams 만 변경) 에서는 loading.tsx 가 자동
          노출되지 않으므로 useTransition isPending 으로 직접 overlay. */}
      {isPending && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-40 bg-black/15 backdrop-blur-[1px] flex items-center justify-center"
        >
          <div className="flex items-center gap-3 px-5 py-3.5 rounded-xl bg-bg-card border border-[color:var(--border)] shadow-md">
            <Loader2
              className="size-5 animate-spin text-[color:var(--text-muted)]"
              strokeWidth={1.75}
              aria-hidden
            />
            <span className="text-[14px] text-[color:var(--text)]">
              불러오는 중...
            </span>
          </div>
        </div>
      )}

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

        {canPickBranch && (
          <select
            aria-label="분원 선택"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            className="
              h-10 min-w-40 rounded-lg px-3
              bg-bg-card border border-[color:var(--border)]
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
        )}

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
            bg-bg-card border border-[color:var(--border)]
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

      {/* 학년 칩 + 졸업·미정 토글 — 학년은 현 학교급에 맞는 옵션만 노출 */}
      <div className="flex flex-wrap gap-x-6 gap-y-3 items-center pt-1">
        <FilterGroup label="학년">
          {gradeOptionsForLevel(level).map((g) => (
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
                : "bg-bg-card text-[color:var(--text-muted)] border-[color:var(--border)] hover:text-[color:var(--text)] hover:bg-[color:var(--bg-hover)]"
            }
          `}
        >
          <Eye className="size-3.5" strokeWidth={1.75} aria-hidden />
          졸업·미정 포함 보기
        </button>
      </div>

      {/* 재원 상태 + 지역 칩 */}
      <div className="flex flex-wrap gap-x-6 gap-y-3 items-start pt-1">
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

        <FilterGroup label="지역">
          {REGION_OPTIONS.map((r) => (
            <Chip
              key={r}
              label={r}
              active={regions.includes(r)}
              onClick={() => toggleValue("region", r)}
            />
          ))}
        </FilterGroup>
      </div>

      {/* 학교 (펼치기 토글 + 지역별 그룹 칩 패널) */}
      <div className="pt-1">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSchoolPanelOpen((o) => !o)}
            aria-expanded={schoolPanelOpen}
            aria-controls="student-school-panel"
            className="
              inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md
              text-[13px] font-medium text-[color:var(--text-muted)]
              hover:text-[color:var(--text)] hover:bg-[color:var(--bg-hover)]
              transition-colors
            "
          >
            <span>학교</span>
            {schools.length > 0 && (
              <span
                className="
                  inline-flex items-center justify-center
                  h-5 min-w-5 px-1.5 rounded-full
                  bg-[color:var(--action)] text-[color:var(--action-text)]
                  text-[12px] font-semibold tabular-nums
                "
              >
                {schools.length}
              </span>
            )}
            <ChevronDown
              className={`size-3.5 transition-transform ${
                schoolPanelOpen ? "rotate-180" : ""
              }`}
              strokeWidth={1.75}
              aria-hidden
            />
          </button>

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

        {/* 접혀 있을 때: 선택된 학교가 있으면 요약 칩으로 노출 */}
        {!schoolPanelOpen && schools.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {schools.map((s) => (
              <SelectedChip
                key={s}
                label={s}
                onRemove={() => toggleMulti("school", s)}
              />
            ))}
          </div>
        )}

        {/* 펼쳐졌을 때: 5개 지역 그룹별 학교 칩 */}
        {schoolPanelOpen && (
          <div
            id="student-school-panel"
            className="
              mt-3 rounded-xl
              bg-[color:var(--bg-muted)]
              p-4 space-y-4
            "
          >
            {schoolGroups.every((g) => g.schools.length === 0) ? (
              <p className="text-[13px] text-[color:var(--text-muted)]">
                표시할 학교가 없습니다.
              </p>
            ) : (
              schoolGroups.map((group) => {
                if (group.schools.length === 0) return null;
                const selectedInGroup = group.schools.filter((s) =>
                  schools.includes(s),
                ).length;
                return (
                  <div key={group.region}>
                    <h4 className="mb-1.5 flex items-baseline gap-1.5 text-[13px] font-semibold text-[color:var(--text)]">
                      {group.region}
                      <span className="text-[12px] font-normal text-[color:var(--text-muted)] tabular-nums">
                        {selectedInGroup > 0
                          ? `${selectedInGroup}/${group.schools.length}`
                          : `${group.schools.length}`}
                      </span>
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {group.schools.map((s) => (
                        <Chip
                          key={s}
                          label={s}
                          active={schools.includes(s)}
                          onClick={() => toggleMulti("school", s)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
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
            : "bg-bg-card text-[color:var(--text)] border-[color:var(--border)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--bg-hover)]"
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
      className="inline-flex h-10 rounded-lg bg-[color:var(--bg-muted)] p-1"
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

