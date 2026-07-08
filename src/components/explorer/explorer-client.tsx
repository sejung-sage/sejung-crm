"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
  Search,
} from "lucide-react";
import type { ExplorerDataset } from "@/lib/explorer/datasets";
import {
  runStudentExplorerAction,
  getExplorerSchoolOptionsAction,
  type ExplorerRunResult,
} from "@/app/explorer/actions";
import type { SchoolGroup } from "@/lib/profile/list-filter-options";
import { BRANCH_FILTER_OPTIONS } from "@/config/branches";
import { REGION_OPTIONS } from "@/config/regions";
import {
  SUBJECT_VALUES,
  CLASS_MARK_VALUES,
} from "@/lib/schemas/common";

/** 강좌 구분 코드(#/@) → 칩 라벨. @=내신, #=특강. */
const CLASS_MARK_LABEL: Record<string, string> = {
  "@": "내신(@)",
  "#": "특강(#)",
};

/**
 * 데이터 탐색기 본체 — CRM 학생조회(listStudents) 와 동일한 빠른 파이프라인 재사용.
 *
 * student_profiles 뷰를 직접 정렬·풀집계하면 느리므로(107k×무거운 서브쿼리),
 * CRM /students 와 같은 2단계+RPC 경로(runStudentExplorerAction)로 조회한다.
 * 프리셋 칩/드롭다운 → 서버에서 ListStudentsInput 으로 매핑.
 */

const GRADE_OPTIONS = [
  "초등", "중1", "중2", "중3", "고1", "고2", "고3", "재수", "졸업", "미정",
] as const;
const LEVEL_OPTIONS = ["전체", "초", "중", "고", "기타"] as const;
const STATUS_OPTIONS = ["재원생", "수강이력자", "수강 x", "탈퇴"] as const;
const PAGE_SIZE_OPTIONS = [50, 100, 200] as const;

const SORT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "registered_desc", label: "최근 등록순" },
  { value: "registered_asc", label: "오래된 등록순" },
  { value: "name_asc", label: "이름 가나다순" },
  { value: "name_desc", label: "이름 역순" },
  { value: "enrollment_count_desc", label: "수강 많은 순 (누적)" },
  { value: "active_enrollment_count_desc", label: "수강 중 많은 순" },
  { value: "total_paid_desc", label: "누적 결제 많은 순" },
];

interface Presets {
  search: string;
  branch: string;
  level: string;
  grades: string[];
  statuses: string[];
  subjects: string[];
  /** 과목 매칭 모드. false=하나라도(합집합), true=전부(교집합). */
  subjectsMatchAll: boolean;
  /** 강좌 접두 코드 필터. classMarks=#/@ (@=내신, #=특강). */
  classMarks: string[];
  regions: string[];
  schools: string[];
  sort: string;
}

const EMPTY_PRESETS: Presets = {
  search: "",
  branch: "전체",
  level: "전체",
  grades: [],
  statuses: [],
  subjects: [],
  subjectsMatchAll: false,
  classMarks: [],
  regions: [],
  schools: [],
  sort: "registered_desc",
};

export function ExplorerClient({
  datasets,
  initialSchoolGroups,
}: {
  datasets: ReadonlyArray<ExplorerDataset>;
  initialSchoolGroups: SchoolGroup[];
}) {
  const [p, setP] = useState<Presets>(EMPTY_PRESETS);
  const [schoolGroups, setSchoolGroups] =
    useState<SchoolGroup[]>(initialSchoolGroups);
  const [schoolPanelOpen, setSchoolPanelOpen] = useState(false);
  const [schoolQuery, setSchoolQuery] = useState("");
  const [pageSize, setPageSize] = useState<number>(100);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ExplorerRunResult | null>(null);
  const [running, setRunning] = useState(false);

  const datasetNote = datasets.find(
    (d) => d.name === "student_profiles",
  )?.note;
  const runSeq = useRef(0);

  const execute = useCallback(
    async (args: { presets: Presets; page: number; pageSize: number }) => {
      const seq = ++runSeq.current;
      setRunning(true);
      try {
        const r = await runStudentExplorerAction({
          search: args.presets.search,
          branch: args.presets.branch,
          level: args.presets.level,
          grades: args.presets.grades,
          statuses: args.presets.statuses,
          subjects: args.presets.subjects,
          subjectsMatchAll: args.presets.subjectsMatchAll,
          classMarks: args.presets.classMarks,
          regions: args.presets.regions,
          schools: args.presets.schools,
          sort: args.presets.sort,
          page: args.page,
          pageSize: args.pageSize,
        });
        if (seq === runSeq.current) setResult(r);
      } finally {
        if (seq === runSeq.current) setRunning(false);
      }
    },
    [],
  );

  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    void execute({ presets: EMPTY_PRESETS, page: 1, pageSize: 100 });
  }, [execute]);

  /** 칩/드롭다운 변경 → 페이지 1 리셋하고 즉시 재조회. */
  const applyPresets = (patch: Partial<Presets>) => {
    const next = { ...p, ...patch };
    setP(next);
    setPage(1);
    void execute({ presets: next, page: 1, pageSize });
  };

  /** 텍스트(검색)는 onChange 로 상태만, 조회는 Enter/버튼. */
  const runSearch = () => {
    setPage(1);
    void execute({ presets: p, page: 1, pageSize });
  };

  const toggleIn =
    (
      key:
        | "grades"
        | "statuses"
        | "subjects"
        | "classMarks"
        | "regions",
    ) =>
    (value: string) => {
      const cur = p[key];
      const next = cur.includes(value)
        ? cur.filter((v) => v !== value)
        : [...cur, value];
      applyPresets({ [key]: next } as Partial<Presets>);
    };

  /** 분원 변경 → 학교 선택 초기화 + 학교 옵션 풀 재조회(분원별로 다름). */
  const onBranchChange = (branch: string) => {
    const next = { ...p, branch, schools: [] };
    setP(next);
    setPage(1);
    void execute({ presets: next, page: 1, pageSize });
    void (async () => {
      const r = await getExplorerSchoolOptionsAction(branch);
      if (r.ok) setSchoolGroups(r.schoolGroups);
    })();
  };

  const toggleSchool = (school: string) => {
    const next = p.schools.includes(school)
      ? p.schools.filter((s) => s !== school)
      : [...p.schools, school];
    applyPresets({ schools: next });
  };

  const goPage = (next: number) => {
    if (next < 1) return;
    setPage(next);
    void execute({ presets: p, page: next, pageSize });
  };

  const changePageSize = (ps: number) => {
    setPageSize(ps);
    setPage(1);
    void execute({ presets: p, page: 1, pageSize: ps });
  };

  const clearAll = () => {
    setP(EMPTY_PRESETS);
    setPage(1);
    setSchoolPanelOpen(false);
    setSchoolQuery("");
    void execute({ presets: EMPTY_PRESETS, page: 1, pageSize });
    void (async () => {
      const r = await getExplorerSchoolOptionsAction("전체");
      if (r.ok) setSchoolGroups(r.schoolGroups);
    })();
  };

  const hasFilters =
    p.search.trim() !== "" ||
    p.branch !== "전체" ||
    p.level !== "전체" ||
    p.grades.length > 0 ||
    p.statuses.length > 0 ||
    p.subjects.length > 0 ||
    p.classMarks.length > 0 ||
    p.regions.length > 0 ||
    p.schools.length > 0;

  const exportCsv = () => {
    if (!result || result.rows.length === 0) return;
    const cols = result.columns;
    const esc = (v: unknown): string => {
      const s =
        v === null || v === undefined
          ? ""
          : typeof v === "object"
            ? JSON.stringify(v)
            : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      cols.join(","),
      ...result.rows.map((r) => cols.map((c) => esc(r[c])).join(",")),
    ];
    const blob = new Blob(["﻿" + lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `students_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalLabel =
    result?.total != null ? `${result.total.toLocaleString()}명` : "—";

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div>
        <h1 className="text-[18px] font-semibold text-[color:var(--text)]">
          학생 데이터 탐색
        </h1>
        {datasetNote && (
          <p className="mt-0.5 text-[12px] text-[color:var(--text-dim)]">
            {datasetNote}
          </p>
        )}
      </div>

      {/* ── 프리셋 필터 (CRM 학생조회 스타일) ── */}
      <div className="rounded-xl border border-[color:var(--border)] bg-bg-card p-4 space-y-3.5">
        {/* 검색 + 분원 + 학교급 + 정렬 + 페이지크기 */}
        <div className="flex flex-wrap items-end gap-3">
          <Field label="검색 (이름·학교·연락처)">
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[color:var(--text-dim)]"
                strokeWidth={1.75}
                aria-hidden
              />
              <input
                value={p.search}
                onChange={(e) => setP({ ...p, search: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
                placeholder="이름·학교·연락처"
                className={`${inputCls} w-64 pl-9`}
              />
            </div>
          </Field>
          <Field label="분원">
            <select
              value={p.branch}
              onChange={(e) => onBranchChange(e.target.value)}
              className={selectCls}
            >
              {BRANCH_FILTER_OPTIONS.map((b) => (
                <option key={b} value={b}>
                  {b === "전체" ? "전체 분원" : b}
                </option>
              ))}
            </select>
          </Field>
          <Field label="학교급">
            <select
              value={p.level}
              onChange={(e) => applyPresets({ level: e.target.value })}
              className={selectCls}
            >
              {LEVEL_OPTIONS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="정렬">
            <select
              value={p.sort}
              onChange={(e) => applyPresets({ sort: e.target.value })}
              className={selectCls}
            >
              {SORT_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="페이지당">
            <select
              value={pageSize}
              onChange={(e) => changePageSize(Number(e.target.value))}
              className={selectCls}
            >
              {PAGE_SIZE_OPTIONS.map((ps) => (
                <option key={ps} value={ps}>
                  {ps}명씩
                </option>
              ))}
            </select>
          </Field>
          <button
            type="button"
            onClick={runSearch}
            className="h-10 px-4 rounded-lg text-[14px] font-medium bg-[color:var(--action)] text-[color:var(--action-text)] hover:bg-[color:var(--action-hover)] transition-colors"
          >
            조회
          </button>
        </div>

        <ChipGroup
          label="학년"
          options={GRADE_OPTIONS}
          selected={p.grades}
          onToggle={toggleIn("grades")}
        />
        <ChipGroup
          label="재원 상태"
          options={STATUS_OPTIONS}
          selected={p.statuses}
          onToggle={toggleIn("statuses")}
        />
        <ChipGroup
          label="수강 과목"
          options={SUBJECT_VALUES}
          selected={p.subjects}
          onToggle={toggleIn("subjects")}
        />
        {p.subjects.length >= 2 && (
          <div className="flex items-center gap-2 pl-[72px]">
            <span className="text-[13px] text-[color:var(--text-muted)]">
              선택 과목을
            </span>
            <div className="inline-flex rounded-lg border border-[color:var(--border)] overflow-hidden">
              {(
                [
                  { val: false, label: "하나라도 수강 (합집합)" },
                  { val: true, label: "모두 수강 (교집합)" },
                ] as const
              ).map((o) => {
                const on = p.subjectsMatchAll === o.val;
                return (
                  <button
                    key={String(o.val)}
                    type="button"
                    onClick={() => applyPresets({ subjectsMatchAll: o.val })}
                    aria-pressed={on}
                    className={`h-8 px-3 text-[13px] font-medium transition-colors ${
                      on
                        ? "bg-[color:var(--action)] text-[color:var(--action-text)]"
                        : "bg-bg-card text-[color:var(--text)] hover:bg-[color:var(--bg-hover)]"
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <ChipGroup
          label="강좌 구분"
          options={CLASS_MARK_VALUES}
          selected={p.classMarks}
          onToggle={toggleIn("classMarks")}
          optionLabel={(v) => CLASS_MARK_LABEL[v] ?? v}
        />
        <ChipGroup
          label="지역"
          options={REGION_OPTIONS}
          selected={p.regions}
          onToggle={toggleIn("regions")}
        />

        {/* 학교 선택 (CRM 학생조회와 동일 — 지역별 그룹 + 검색 + 칩) */}
        <div className="flex items-start gap-2">
          <span className="mt-1.5 w-16 shrink-0 text-[13px] font-medium text-[color:var(--text-muted)]">
            학교
          </span>
          <div className="flex-1">
            <button
              type="button"
              onClick={() => setSchoolPanelOpen((o) => !o)}
              aria-expanded={schoolPanelOpen}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[13px] font-medium text-[color:var(--text-muted)] hover:text-[color:var(--text)] hover:bg-[color:var(--bg-hover)] transition-colors"
            >
              <span>학교 선택</span>
              {p.schools.length > 0 && (
                <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-[color:var(--action)] text-[color:var(--action-text)] text-[12px] font-semibold tabular-nums">
                  {p.schools.length}
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

            {/* 접힘: 선택된 학교 칩 요약 */}
            {!schoolPanelOpen && p.schools.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {p.schools.map((s) => (
                  <span
                    key={s}
                    className="inline-flex items-center gap-1 h-8 pl-3 pr-1 rounded-full text-[14px] font-medium bg-[color:var(--bg-muted)] text-[color:var(--text)] border border-[color:var(--border)]"
                  >
                    <span className="truncate max-w-[12rem]">{s}</span>
                    <button
                      type="button"
                      onClick={() => toggleSchool(s)}
                      aria-label={`${s} 제거`}
                      className="inline-flex items-center justify-center size-6 rounded-full text-[color:var(--text-muted)] hover:text-[color:var(--text)] hover:bg-[color:var(--bg-hover)]"
                    >
                      <X className="size-3.5" strokeWidth={1.75} aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {schoolPanelOpen && (
              <SchoolPanel
                schoolGroups={schoolGroups}
                selected={p.schools}
                query={schoolQuery}
                onQueryChange={setSchoolQuery}
                onToggle={toggleSchool}
              />
            )}
          </div>
        </div>

        {hasFilters && (
          <div className="pt-0.5">
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-medium text-red-600 border border-red-300 bg-bg-card hover:bg-red-50 transition-colors"
            >
              <X className="size-4" strokeWidth={1.75} aria-hidden />
              필터 초기화
            </button>
          </div>
        )}
      </div>

      {/* ── 결과 헤더 ── */}
      <div className="flex items-center justify-between">
        <p className="text-[14px] text-[color:var(--text-muted)]">
          {result ? (
            <>
              <span className="font-medium text-[color:var(--text)]">
                총 {totalLabel}
              </span>
              <span className="mx-1.5 text-[color:var(--text-dim)]">·</span>
              {result.rows.length}명 표시 ({result.page}페이지)
            </>
          ) : (
            "불러오는 중…"
          )}
        </p>
        <button
          type="button"
          onClick={exportCsv}
          disabled={!result || result.rows.length === 0}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-medium bg-bg-card text-[color:var(--text)] border border-[color:var(--border)] hover:bg-[color:var(--bg-hover)] disabled:opacity-50 transition-colors"
          title="현재 페이지 결과를 CSV 로 내려받습니다(Excel 호환)"
        >
          <Download className="size-4" strokeWidth={1.75} aria-hidden />
          CSV 내보내기
        </button>
      </div>

      {result?.error ? (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-[14px] text-red-700">
          {result.error}
        </div>
      ) : (
        <ResultsTable
          columns={result?.columns ?? []}
          rows={result?.rows ?? []}
          running={running}
        />
      )}

      {result && result.rows.length > 0 && (
        <div className="flex items-center justify-center gap-2">
          <PagerButton
            disabled={page <= 1 || running}
            onClick={() => goPage(page - 1)}
            ariaLabel="이전 페이지"
          >
            <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
          </PagerButton>
          <span className="text-[13px] tabular-nums text-[color:var(--text-muted)]">
            {page} 페이지
          </span>
          <PagerButton
            disabled={result.rows.length < result.pageSize || running}
            onClick={() => goPage(page + 1)}
            ariaLabel="다음 페이지"
          >
            <ChevronRight className="size-4" strokeWidth={1.75} aria-hidden />
          </PagerButton>
        </div>
      )}
    </div>
  );
}

const inputCls =
  "h-10 rounded-lg px-3 bg-bg-card border border-[color:var(--border)] text-[14px] text-[color:var(--text)] placeholder:text-[color:var(--text-dim)] focus:outline-none focus:border-[color:var(--border-strong)]";
const selectCls =
  "h-10 rounded-lg px-3 bg-bg-card border border-[color:var(--border)] text-[14px] text-[color:var(--text)] focus:outline-none focus:border-[color:var(--border-strong)] cursor-pointer";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-medium text-[color:var(--text-muted)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function ChipGroup({
  label,
  options,
  selected,
  onToggle,
  optionLabel,
}: {
  label: string;
  options: ReadonlyArray<string>;
  selected: string[];
  onToggle: (v: string) => void;
  /** 칩 표시 라벨 (값과 다를 때). 예: "R" → "정규(R)". */
  optionLabel?: (value: string) => string;
}) {
  return (
    <div className="flex items-start flex-wrap gap-2">
      <span className="mt-1.5 w-16 shrink-0 text-[13px] font-medium text-[color:var(--text-muted)]">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = selected.includes(o);
          return (
            <button
              key={o}
              type="button"
              onClick={() => onToggle(o)}
              aria-pressed={on}
              className={`inline-flex items-center h-8 px-3 rounded-full text-[14px] font-medium border transition-colors ${
                on
                  ? "bg-[color:var(--action)] text-[color:var(--action-text)] border-[color:var(--action)]"
                  : "bg-bg-card text-[color:var(--text)] border-[color:var(--border)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--bg-hover)]"
              }`}
            >
              {optionLabel ? optionLabel(o) : o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 학교 검색·선택 패널 — CRM /students 의 SchoolSearchPanel 과 동일 UX.
 * 지역별 그룹 + 부분일치 검색 + 칩 토글. 매칭 없는 그룹은 숨김.
 */
function SchoolPanel({
  schoolGroups,
  selected,
  query,
  onQueryChange,
  onToggle,
}: {
  schoolGroups: SchoolGroup[];
  selected: string[];
  query: string;
  onQueryChange: (q: string) => void;
  onToggle: (school: string) => void;
}) {
  const normalized = query.trim().toLowerCase();
  const filtered = schoolGroups
    .map((g) => ({
      region: g.region,
      schools:
        normalized.length === 0
          ? g.schools
          : g.schools.filter((s) => s.toLowerCase().includes(normalized)),
    }))
    .filter((g) => g.schools.length > 0);

  const totalMatched = filtered.reduce((sum, g) => sum + g.schools.length, 0);

  return (
    <div className="mt-3 rounded-xl bg-[color:var(--bg-muted)] p-4 space-y-3">
      <label className="relative block">
        <span className="sr-only">학교 검색</span>
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[color:var(--text-dim)]"
          strokeWidth={1.75}
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="학교명 검색 (예: 휘문, 단대부)"
          className="w-full h-10 rounded-lg pl-9 pr-3 bg-bg-card border border-[color:var(--border)] text-[14px] text-[color:var(--text)] placeholder:text-[color:var(--text-dim)] focus:outline-none focus:border-[color:var(--border-strong)]"
        />
      </label>

      <p className="text-[12px] text-[color:var(--text-muted)]">
        {normalized.length > 0
          ? `검색 결과 ${totalMatched.toLocaleString()}개`
          : `총 ${schoolGroups
              .reduce((s, g) => s + g.schools.length, 0)
              .toLocaleString()}개 학교`}
        {selected.length > 0 && (
          <>
            <span className="mx-1.5 text-[color:var(--text-dim)]">·</span>
            <span>선택 {selected.length}개</span>
          </>
        )}
      </p>

      <div className="max-h-[420px] overflow-y-auto space-y-4 pr-1">
        {filtered.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-[color:var(--text-muted)]">
            {normalized.length > 0
              ? `"${query.trim()}" 와(과) 일치하는 학교가 없습니다.`
              : "표시할 학교가 없습니다."}
          </p>
        ) : (
          filtered.map((group) => {
            const selectedInGroup = group.schools.filter((s) =>
              selected.includes(s),
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
                  {group.schools.map((s) => {
                    const on = selected.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => onToggle(s)}
                        aria-pressed={on}
                        className={`inline-flex items-center h-8 px-3 rounded-full text-[14px] font-medium border transition-colors ${
                          on
                            ? "bg-[color:var(--action)] text-[color:var(--action-text)] border-[color:var(--action)]"
                            : "bg-bg-card text-[color:var(--text)] border-[color:var(--border)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--bg-hover)]"
                        }`}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function ResultsTable({
  columns,
  rows,
  running,
}: {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  running: boolean;
}) {
  if (columns.length === 0 || rows.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-bg-card py-16 text-center text-[14px] text-[color:var(--text-muted)]">
        {running ? "불러오는 중…" : "조건에 맞는 학생이 없습니다."}
      </div>
    );
  }
  return (
    <div
      className={`rounded-xl border border-[color:var(--border)] bg-bg-card overflow-auto max-h-[70vh] transition-opacity ${
        running ? "opacity-60" : ""
      }`}
    >
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10">
          <tr className="bg-[color:var(--bg-muted)] border-b border-[color:var(--border)]">
            {columns.map((c) => (
              <th
                key={c}
                className="px-3 py-2 text-left font-medium text-[color:var(--text-muted)] whitespace-nowrap"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-[color:var(--border)] last:border-b-0 hover:bg-[color:var(--bg-hover)]"
            >
              {columns.map((c) => (
                <td
                  key={c}
                  className="px-3 py-1.5 whitespace-nowrap text-[color:var(--text)] max-w-[320px] truncate"
                  title={formatCell(row[c])}
                >
                  {formatCell(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "–";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function PagerButton({
  children,
  disabled,
  onClick,
  ariaLabel,
}: {
  children: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      className="inline-flex items-center justify-center size-9 rounded-lg bg-bg-card border border-[color:var(--border)] text-[color:var(--text)] hover:bg-[color:var(--bg-hover)] disabled:opacity-40 transition-colors"
    >
      {children}
    </button>
  );
}
