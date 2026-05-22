"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useTransition } from "react";
import { CalendarDays, Search, X } from "lucide-react";

import { BRANCH_FILTER_OPTIONS } from "@/config/branches";
import {
  CLASS_DAY_VALUES,
  CLASS_SORT_VALUES,
  type ClassDay,
  type ClassSort,
} from "@/lib/schemas/class";
import { SEASON_VALUES } from "@/lib/schemas/common";
import { MultiSelectDropdown } from "@/components/shell/multi-select-dropdown";

/**
 * F0 · 강좌 리스트 상단 툴바.
 *
 * - 1행(검색·드롭다운): 검색 + 분원 + 과목 + 정렬 + 진행/종강 segment
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
 *  - ?status=all|progressing|seminar : 진행 상태 (단일, default all)
 *
 * 분원 변경 시 강사 선택은 자동 초기화 (분원이 바뀌면 강사 풀이 달라지므로).
 * 필터 변경 시 page 는 항상 1 로 리셋.
 *
 * 0020 마이그레이션 이후 "미사용 포함" 토글은 제거 — V_class_list 의 active
 * 신호가 사실상 100% true 로 들어와 분별 가치가 사라졌다. 그 자리에 진행/종강
 * status segment 를 둔다. backend 의 active 필터 코드는 그대로 유지 (무해).
 */

const SUBJECT_OPTIONS = [
  "전체",
  "국어",
  "영어",
  "수학",
  "과탐",
  "사탐",
  "컨설팅",
  "기타",
] as const;

/**
 * 시즌 dropdown 옵션 — "전체" + SEASON_VALUES 6종 (0070 마이그).
 * "전체" 선택 시 URL `?season` 제거 → backend 필터 미적용.
 * SEASON_VALUES 와 1:1 동기 — 단일 출처는 schemas/common.ts.
 */
const SEASON_OPTIONS = ["전체", ...SEASON_VALUES] as const;

/**
 * 정렬 enum → 한글 라벨 매핑.
 * CLASS_SORT_VALUES 13종 동기화 필수 — 누락 시 컴파일 오류 (Record<ClassSort, ...>).
 *
 * enrolled_count_* 는 backend-dev 보고대로 페이지 한정 정렬 (DB 측 집계
 * 컬럼 부재). 사용자 혼동 방지를 위해 옵션 라벨 옆에 작은 muted 주석을 단다.
 * start_date_* 는 DB 단 ORDER BY (NULLS LAST) 라 페이지 한정 X — 일반 라벨.
 */
const SORT_LABELS: Record<ClassSort, string> = {
  // default 의 실제 backend 동작(분원>과목>반명)은 유지하되, 운영자에게는
  // "최신 등록순" 으로 보이게 라벨만 단순화. (실제 등록일 정렬은 registered_desc.)
  // — 행정팀이 셀렉트를 처음 열었을 때 "기본 정렬" 이라는 추상적 단어보다
  //   "최신 등록순" 같은 구체 표현이 빨리 이해됨.
  default: "최신 등록순",
  registered_desc: "강좌 등록일 ↓",
  registered_asc: "강좌 등록일 ↑",
  start_date_desc: "최근 개강순",
  start_date_asc: "오래된 개강순",
  end_date_desc: "최근 종강순",
  end_date_asc: "오래된 종강순",
  name_asc: "반명 가나다순",
  name_desc: "반명 가나다 역순",
  enrolled_count_desc: "수강생 많은 순 (현재 페이지 내 정렬)",
  enrolled_count_asc: "수강생 적은 순 / 정원 미달 (현재 페이지 내 정렬)",
  capacity_desc: "정원 많은 순",
  amount_per_session_desc: "회당단가 높은 순",
  amount_per_session_asc: "회당단가 낮은 순",
  total_sessions_desc: "총회차 많은 순",
};

/**
 * 진행 상태 status segment 라벨.
 * URL 미존재 → backend default "all" 동작 (전체 노출).
 * 작업지시 (2026-05): 라벨/순서 "전체 · 진행중 · 설명회" 로 재편.
 *  - 전체     : ?status=all (또는 ?status 미지정)
 *  - 진행중   : ?status=progressing
 *  - 설명회   : ?status=seminar  (backend schema 에서 'seminar' enum 추가됨)
 */
type StatusSegment = "all" | "progressing" | "seminar";
const STATUS_SEGMENTS: ReadonlyArray<{ value: StatusSegment; label: string }> = [
  { value: "all", label: "전체" },
  { value: "progressing", label: "진행중" },
  { value: "seminar", label: "설명회" },
];
const STATUS_WHITELIST: ReadonlySet<string> = new Set([
  "all",
  "progressing",
  "seminar",
]);

const SORT_WHITELIST: ReadonlySet<string> = new Set(CLASS_SORT_VALUES);
const DAY_WHITELIST: ReadonlySet<string> = new Set(CLASS_DAY_VALUES);

interface Props {
  /** 부모(Server Component) 가 prefetch 해서 넘겨주는 강사 후보. */
  teacherOptions: string[];
  /** master 만 분원 select 노출. 그 외는 사이드바 표시로 충분. */
  canPickBranch: boolean;
}

export function ClassesToolbar({ teacherOptions, canPickBranch }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const q = searchParams.get("q") ?? "";
  const branch = searchParams.get("branch") ?? "전체";
  const subjectParam = searchParams.get("subject");
  const SUBJECT_WHITELIST: ReadonlySet<string> = new Set([
    "국어",
    "영어",
    "수학",
    "과탐",
    "사탐",
    "컨설팅",
    "기타",
  ]);
  const subject =
    subjectParam && SUBJECT_WHITELIST.has(subjectParam)
      ? subjectParam
      : "전체";

  // 시즌 — 화이트리스트 외 입력은 "전체" 로 폴백 (필터 미적용).
  // SEASON_VALUES 와 1:1 동기. 0070 마이그.
  const seasonParam = searchParams.get("season");
  const SEASON_WHITELIST: ReadonlySet<string> = new Set(SEASON_VALUES);
  const season =
    seasonParam && SEASON_WHITELIST.has(seasonParam) ? seasonParam : "전체";

  // 다중 키 — 반복 파라미터 (?teacher=A&teacher=B, ?day=월&day=수).
  const teachers = searchParams.getAll("teacher");
  const days = searchParams
    .getAll("day")
    .filter((d): d is ClassDay => DAY_WHITELIST.has(d));

  // 진행/종강 status segment. URL 미존재(또는 화이트리스트 외) → "all".
  // backend default 와 동일하므로 화면상 "전체" 가 기본 활성으로 보인다.
  const statusRaw = searchParams.get("status");
  const status: StatusSegment =
    statusRaw && STATUS_WHITELIST.has(statusRaw)
      ? (statusRaw as StatusSegment)
      : "all";

  const sortRaw = searchParams.get("sort");
  const sort: ClassSort =
    sortRaw && SORT_WHITELIST.has(sortRaw)
      ? (sortRaw as ClassSort)
      : "default";

  // 종강·폐강(=active=false) 포함 토글.
  // URL `?inactive=1` 이면 backend 의 active 필터를 해제 (active=0 으로 전달).
  // 기본은 off → 운영 시야에는 active=true 만 보임.
  const includeInactive = searchParams.get("inactive") === "1";

  // 기간 필터 — 시작일(start) ~ 종료일(end). 둘 다 비어 있을 수 있고,
  // 한쪽만 들어와도 허용 (open-ended range). backend 는 이 범위에 ticket(class_date)
  // 가 1건이라도 있는 강좌만 반환.
  const startRaw = searchParams.get("start") ?? "";
  const endRaw = searchParams.get("end") ?? "";
  const startValue = /^\d{4}-\d{2}-\d{2}$/.test(startRaw) ? startRaw : "";
  const endValue = /^\d{4}-\d{2}-\d{2}$/.test(endRaw) ? endRaw : "";

  // "오늘" 의 KST 'YYYY-MM-DD' — 빠른 선택 버튼용.
  // 매 렌더마다 동일하므로 useMemo. SSR/CSR 경계는 toolbar 가 client 컴포넌트라
  // 신경 쓸 필요 없고, 자정 경계에 새로 마운트되면 자연스럽게 갱신됨.
  const todayDate = useMemo(() => {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return fmt.format(new Date()); // 'YYYY-MM-DD'
  }, []);

  const updateParams = useCallback(
    (mutator: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams.toString());
      mutator(next);
      // 필터 변경 시 페이지 1 로 리셋
      next.delete("page");
      startTransition(() => {
        // push 만 하면 Next prefetch cache 가 stale 결과 노출 (강사 chip
        // 제거해도 list 안 갱신되던 회귀, 2026-05-21). refresh 동반으로
        // server component 강제 재페치. 이후 모든 필터 토글에 동일 패턴 적용.
        router.push(`${pathname}?${next.toString()}`);
        router.refresh();
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

  /**
   * 시즌 변경 — "전체" 는 canonical URL 짧게 유지하려고 URL 에서 제거.
   * 그 외 값은 SEASON_VALUES 화이트리스트 안에 있다고 가정 (select option 자체가 그것).
   */
  const onSeasonChange = (value: string) => {
    updateParams((p) => {
      if (value === "전체") p.delete("season");
      else p.set("season", value);
    });
  };

  const onSortChange = (value: ClassSort) => {
    updateParams((p) => {
      if (value === "default") p.delete("sort");
      else p.set("sort", value);
    });
  };

  const onStatusChange = (value: StatusSegment) => {
    updateParams((p) => {
      // "all" 은 기본값이라 URL 에서 제거 (canonical URL 짧게 유지).
      if (value === "all") p.delete("status");
      else p.set("status", value);
    });
  };

  /**
   * 종강·폐강(=active=false) 강좌 포함 토글.
   * URL: `?inactive=1` (켜짐), 미존재 (꺼짐).
   * backend 가 `?active=0` 만 인식한다면 동시에 그쪽도 set/unset 해서 안전 호환.
   */
  const onIncludeInactiveChange = (checked: boolean) => {
    updateParams((p) => {
      if (checked) {
        p.set("inactive", "1");
        p.set("active", "0"); // backend 호환 (active 기본값=true 해제)
      } else {
        p.delete("inactive");
        p.delete("active");
      }
    });
  };

  /**
   * 기간 필터 — 시작일/종료일은 서로 독립. 한쪽만 비어 있어도 허용.
   * 값이 'YYYY-MM-DD' 정규식에 맞을 때만 URL 에 set, 아니면 unset.
   */
  const onStartChange = (value: string) => {
    updateParams((p) => {
      if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        p.set("start", value);
      } else {
        p.delete("start");
      }
    });
  };

  const onEndChange = (value: string) => {
    updateParams((p) => {
      if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        p.set("end", value);
      } else {
        p.delete("end");
      }
    });
  };

  /** "오늘" 빠른 버튼 — 시작=종료=오늘 으로 한 번에 셋. */
  const onSetTodayRange = () => {
    updateParams((p) => {
      p.set("start", todayDate);
      p.set("end", todayDate);
    });
  };

  const onClearDateRange = () => {
    updateParams((p) => {
      p.delete("start");
      p.delete("end");
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
    season !== "전체" ||
    teachers.length > 0 ||
    days.length > 0 ||
    status !== "all" ||
    startValue !== "" ||
    endValue !== "" ||
    includeInactive;

  const clearAll = () => {
    updateParams((p) => {
      p.delete("q");
      p.delete("branch");
      p.delete("subject");
      p.delete("season");
      p.delete("teacher");
      p.delete("day");
      p.delete("status");
      p.delete("start");
      p.delete("end");
      p.delete("inactive");
      p.delete("active");
      // 정렬은 의도적으로 유지 — 사용자가 명시적으로 바꾼 보기 옵션.
    });
  };

  return (
    <div
      className={`space-y-4 transition-opacity ${isPending ? "opacity-60 pointer-events-none" : ""}`}
      aria-busy={isPending}
    >
      {/* 1행: 검색 + 분원 + 과목 + 정렬 + 진행/종강 segment */}
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
            onChange={(e) => onBranchChange(e.target.value)}
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

        <select
          aria-label="과목 선택"
          value={subject}
          onChange={(e) => onSubjectChange(e.target.value)}
          className="
            h-10 min-w-32 rounded-lg px-3
            bg-bg-card border border-[color:var(--border)]
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

        {/* 시즌 — 0070 마이그. 운영팀 수동 분류 dropdown.
            "전체" 는 URL ?season 제거. */}
        <select
          aria-label="시즌 선택"
          value={season}
          onChange={(e) => onSeasonChange(e.target.value)}
          className="
            h-10 min-w-36 rounded-lg px-3
            bg-bg-card border border-[color:var(--border)]
            text-[15px] text-[color:var(--text)]
            focus:outline-none focus:border-[color:var(--border-strong)]
            cursor-pointer
          "
        >
          {SEASON_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s === "전체" ? "전체 시즌" : s}
            </option>
          ))}
        </select>

        <select
          aria-label="정렬 기준"
          value={sort}
          onChange={(e) => onSortChange(e.target.value as ClassSort)}
          className="
            h-10 min-w-44 rounded-lg px-3
            bg-bg-card border border-[color:var(--border)]
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

        <div
          role="radiogroup"
          aria-label="진행 상태"
          className="
            inline-flex items-stretch h-10 rounded-lg
            bg-bg-card border border-[color:var(--border)]
            overflow-hidden
          "
        >
          {STATUS_SEGMENTS.map((seg, idx) => {
            const active = status === seg.value;
            return (
              <button
                key={seg.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onStatusChange(seg.value)}
                className={`
                  px-3 text-[14px] font-medium transition-colors
                  focus:outline-none focus:ring-1 focus:ring-[color:var(--border-strong)]
                  ${idx > 0 ? "border-l border-[color:var(--border)]" : ""}
                  ${
                    active
                      ? "bg-[color:var(--action)] text-[color:var(--action-text)]"
                      : "bg-bg-card text-[color:var(--text-muted)] hover:text-[color:var(--text)] hover:bg-[color:var(--bg-hover)]"
                  }
                `}
              >
                {seg.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 2행: 기간 필터 (시작일 ~ 종료일 사이에 수업이 1건이라도 있는 강좌) */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
        <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[color:var(--text-muted)] shrink-0">
          <CalendarDays
            className="size-4 text-[color:var(--text-dim)]"
            strokeWidth={1.75}
            aria-hidden
          />
          기간
        </span>

        <input
          type="date"
          aria-label="시작일 선택"
          value={startValue}
          max="2999-12-31"
          onChange={(e) => onStartChange(e.target.value)}
          onClick={(e) => {
            const el = e.currentTarget as HTMLInputElement & {
              showPicker?: () => void;
            };
            el.showPicker?.();
          }}
          className="
            h-10 min-w-44 rounded-lg px-3
            bg-bg-card border border-[color:var(--border)]
            text-[14px] text-[color:var(--text)]
            focus:outline-none focus:border-[color:var(--border-strong)]
            cursor-pointer
          "
        />

        <span
          aria-hidden
          className="text-[14px] text-[color:var(--text-muted)] select-none"
        >
          ~
        </span>

        <input
          type="date"
          aria-label="종료일 선택"
          value={endValue}
          max="2999-12-31"
          onChange={(e) => onEndChange(e.target.value)}
          onClick={(e) => {
            const el = e.currentTarget as HTMLInputElement & {
              showPicker?: () => void;
            };
            el.showPicker?.();
          }}
          className="
            h-10 min-w-44 rounded-lg px-3
            bg-bg-card border border-[color:var(--border)]
            text-[14px] text-[color:var(--text)]
            focus:outline-none focus:border-[color:var(--border-strong)]
            cursor-pointer
          "
        />

        {/* 빠른 선택: 오늘 — 시작=종료=오늘 한 번에 셋. */}
        <button
          type="button"
          onClick={onSetTodayRange}
          className="
            inline-flex items-center h-10 px-3 rounded-lg
            text-[14px] font-medium
            bg-bg-card text-[color:var(--text)]
            border border-[color:var(--border)]
            hover:border-[color:var(--border-strong)]
            hover:bg-[color:var(--bg-hover)]
            transition-colors
          "
        >
          오늘
        </button>

        {(startValue || endValue) && (
          <button
            type="button"
            onClick={onClearDateRange}
            aria-label="기간 필터 초기화"
            className="
              inline-flex items-center gap-1 h-8 px-2 rounded-md
              text-[13px] text-[color:var(--text-muted)]
              hover:text-[color:var(--text)]
              hover:bg-[color:var(--bg-hover)]
              transition-colors
            "
          >
            <X className="size-3.5" strokeWidth={1.75} aria-hidden />
            초기화
          </button>
        )}
      </div>

      {/* 3행: 요일 칩 (다중 토글) */}
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

      {/* 3행: 강사 (드롭다운 + 선택 칩) + 종강·폐강 포함 + 필터 초기화 */}
      <div className="flex flex-wrap gap-x-6 gap-y-3 items-start pt-1">
        <FilterGroup label="강사">
          <MultiSelectDropdown
            label="강사 선택"
            options={teacherOptions}
            selected={teachers}
            onToggle={(v) => toggleMulti("teacher", v)}
            searchable
            searchPlaceholder="강사 검색..."
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

        {/* 종강·폐강(=active=false) 포함 토글. 기본 off. */}
        <label
          className="
            inline-flex items-center gap-2 h-10 px-3 rounded-lg
            text-[14px] text-[color:var(--text)]
            border border-[color:var(--border)] bg-bg-card
            hover:bg-[color:var(--bg-hover)]
            cursor-pointer transition-colors
            select-none
          "
        >
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => onIncludeInactiveChange(e.target.checked)}
            className="size-4 accent-[color:var(--action)] cursor-pointer"
          />
          <span>종강·폐강 포함</span>
        </label>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearAll}
            aria-label="모든 필터 초기화"
            className="
              inline-flex items-center gap-1.5 h-10 px-3 rounded-lg
              text-[14px] font-medium
              text-red-600 border border-red-300 bg-bg-card
              hover:bg-red-50 hover:border-red-400
              focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300
              transition-colors ml-auto
            "
          >
            <X className="size-4" strokeWidth={1.75} aria-hidden />
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
            : "bg-bg-card text-[color:var(--text)] border-[color:var(--border)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--bg-hover)]"
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
