"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import type { ExplorerDataset } from "@/lib/explorer/datasets";
import {
  describeDatasetAction,
  runExplorerQueryAction,
  type ExplorerRunResult,
} from "@/app/explorer/actions";
import { BRANCH_FILTER_OPTIONS } from "@/config/branches";
import { REGION_OPTIONS } from "@/config/regions";
import { SUBJECT_VALUES } from "@/lib/schemas/common";

/**
 * 데이터 탐색기 본체 — CRM 학생조회와 동일한 칩/드롭다운 프리셋 필터.
 *
 * 대상은 student_profiles(학생 명단) 고정. 프리셋 선택을 내부에서 (컬럼·연산자·값)
 * 필터로 변환해 읽기 전용 서버 액션으로 조회한다. 결과는 전체 컬럼 테이블 + CSV.
 */

const DATASET = "student_profiles";

const GRADE_OPTIONS = [
  "초등",
  "중1",
  "중2",
  "중3",
  "고1",
  "고2",
  "고3",
  "재수",
  "졸업",
  "미정",
] as const;
const LEVEL_OPTIONS = ["전체", "초", "중", "고", "기타"] as const;
const STATUS_OPTIONS = ["재원생", "수강이력자", "수강 x", "탈퇴"] as const;
const PAGE_SIZE_OPTIONS = [50, 100, 200, 500] as const;

interface Presets {
  branch: string;
  level: string;
  grades: string[];
  statuses: string[];
  subjects: string[];
  regions: string[];
  school: string;
  name: string;
  regFrom: string;
  regTo: string;
  paidMin: string;
}

const EMPTY_PRESETS: Presets = {
  branch: "전체",
  level: "전체",
  grades: [],
  statuses: [],
  subjects: [],
  regions: [],
  school: "",
  name: "",
  regFrom: "",
  regTo: "",
  paidMin: "",
};

/** 프리셋 → 서버 액션 필터(컬럼·연산자·값) 변환. */
function buildFilters(
  p: Presets,
): Array<{ column: string; operator: string; value: string }> {
  const f: Array<{ column: string; operator: string; value: string }> = [];
  if (p.branch && p.branch !== "전체")
    f.push({ column: "branch", operator: "eq", value: p.branch });
  if (p.level && p.level !== "전체")
    f.push({ column: "school_level", operator: "eq", value: p.level });
  if (p.grades.length)
    f.push({ column: "grade", operator: "in", value: p.grades.join(",") });
  if (p.statuses.length)
    f.push({ column: "status", operator: "in", value: p.statuses.join(",") });
  if (p.subjects.length)
    f.push({
      column: "subjects",
      operator: "overlaps",
      value: p.subjects.join(","),
    });
  if (p.regions.length)
    f.push({ column: "region", operator: "in", value: p.regions.join(",") });
  if (p.school.trim())
    f.push({ column: "school", operator: "ilike", value: p.school.trim() });
  if (p.name.trim())
    f.push({ column: "name", operator: "ilike", value: p.name.trim() });
  if (p.regFrom)
    f.push({ column: "registered_at", operator: "gte", value: p.regFrom });
  if (p.regTo)
    f.push({ column: "registered_at", operator: "lte", value: p.regTo });
  if (p.paidMin.trim())
    f.push({
      column: "total_paid",
      operator: "gte",
      value: p.paidMin.trim(),
    });
  return f;
}

export function ExplorerClient({
  datasets,
}: {
  datasets: ReadonlyArray<ExplorerDataset>;
}) {
  const [columns, setColumns] = useState<string[]>([]);
  const [p, setP] = useState<Presets>(EMPTY_PRESETS);
  const [sortColumn, setSortColumn] = useState<string | undefined>(
    "registered_at",
  );
  const [sortAsc, setSortAsc] = useState(false);
  const [pageSize, setPageSize] = useState<number>(100);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ExplorerRunResult | null>(null);
  const [running, setRunning] = useState(false);

  const datasetNote = datasets.find((d) => d.name === DATASET)?.note;
  const runSeq = useRef(0);

  const execute = useCallback(
    async (args: {
      presets: Presets;
      sortColumn: string | undefined;
      sortAsc: boolean;
      page: number;
      pageSize: number;
    }) => {
      const seq = ++runSeq.current;
      setRunning(true);
      try {
        const r = await runExplorerQueryAction({
          dataset: DATASET,
          filters: buildFilters(args.presets),
          columns: [],
          sortColumn: args.sortColumn,
          sortAsc: args.sortAsc,
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

  // 최초 1회: 컬럼 introspect + 첫 조회.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    void (async () => {
      const d = await describeDatasetAction(DATASET);
      if (d.ok) setColumns(d.columns);
      await execute({
        presets: EMPTY_PRESETS,
        sortColumn: "registered_at",
        sortAsc: false,
        page: 1,
        pageSize: 100,
      });
    })();
  }, [execute]);

  /** 프리셋 변경 → 페이지 1로 리셋하고 즉시 재조회 (CRM 칩 즉시 반영과 동일). */
  const applyPresets = (patch: Partial<Presets>) => {
    const next = { ...p, ...patch };
    setP(next);
    setPage(1);
    void execute({ presets: next, sortColumn, sortAsc, page: 1, pageSize });
  };

  /** 텍스트 입력은 onChange 로 상태만 갱신, 조회는 Enter/버튼에서. */
  const setText = (patch: Partial<Presets>) => setP({ ...p, ...patch });
  const runText = () => {
    setPage(1);
    void execute({ presets: p, sortColumn, sortAsc, page: 1, pageSize });
  };

  const toggleIn = (key: "grades" | "statuses" | "subjects" | "regions") =>
    (value: string) => {
      const cur = p[key];
      const next = cur.includes(value)
        ? cur.filter((v) => v !== value)
        : [...cur, value];
      applyPresets({ [key]: next } as Partial<Presets>);
    };

  const onSort = (col: string) => {
    const asc = sortColumn === col ? !sortAsc : false;
    setSortColumn(col);
    setSortAsc(asc);
    setPage(1);
    void execute({ presets: p, sortColumn: col, sortAsc: asc, page: 1, pageSize });
  };

  const goPage = (next: number) => {
    if (next < 1) return;
    setPage(next);
    void execute({ presets: p, sortColumn, sortAsc, page: next, pageSize });
  };

  const changePageSize = (ps: number) => {
    setPageSize(ps);
    setPage(1);
    void execute({ presets: p, sortColumn, sortAsc, page: 1, pageSize: ps });
  };

  const clearAll = () => {
    setP(EMPTY_PRESETS);
    setPage(1);
    void execute({
      presets: EMPTY_PRESETS,
      sortColumn,
      sortAsc,
      page: 1,
      pageSize,
    });
  };

  const hasFilters =
    p.branch !== "전체" ||
    p.level !== "전체" ||
    p.grades.length > 0 ||
    p.statuses.length > 0 ||
    p.subjects.length > 0 ||
    p.regions.length > 0 ||
    p.school.trim() !== "" ||
    p.name.trim() !== "" ||
    p.regFrom !== "" ||
    p.regTo !== "" ||
    p.paidMin.trim() !== "";

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
    result?.total != null ? `약 ${result.total.toLocaleString()}명` : "—";

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
        {/* 검색 + 학교 + 분원 + 페이지크기 */}
        <div className="flex flex-wrap items-end gap-3">
          <Field label="이름 검색">
            <input
              value={p.name}
              onChange={(e) => setText({ name: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && runText()}
              placeholder="이름"
              className={inputCls}
            />
          </Field>
          <Field label="학교 검색">
            <input
              value={p.school}
              onChange={(e) => setText({ school: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && runText()}
              placeholder="학교명 (예: 휘문)"
              className={inputCls}
            />
          </Field>
          <Field label="분원">
            <select
              value={p.branch}
              onChange={(e) => applyPresets({ branch: e.target.value })}
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
                  {l === "전체" ? "전체" : l}
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
            onClick={runText}
            className="h-10 px-4 rounded-lg text-[14px] font-medium bg-[color:var(--action)] text-[color:var(--action-text)] hover:bg-[color:var(--action-hover)] transition-colors"
          >
            조회
          </button>
        </div>

        {/* 학년 칩 */}
        <ChipGroup
          label="학년"
          options={GRADE_OPTIONS}
          selected={p.grades}
          onToggle={toggleIn("grades")}
        />
        {/* 재원 상태 칩 */}
        <ChipGroup
          label="재원 상태"
          options={STATUS_OPTIONS}
          selected={p.statuses}
          onToggle={toggleIn("statuses")}
        />
        {/* 수강 과목 칩 (현재 진행 중 강좌 기준) */}
        <ChipGroup
          label="수강 과목"
          options={SUBJECT_VALUES}
          selected={p.subjects}
          onToggle={toggleIn("subjects")}
        />
        {/* 지역 칩 */}
        <ChipGroup
          label="지역"
          options={REGION_OPTIONS}
          selected={p.regions}
          onToggle={toggleIn("regions")}
        />

        {/* 등록일 범위 + 누적결제 + 초기화 */}
        <div className="flex flex-wrap items-end gap-3 pt-0.5">
          <Field label="등록일 (이후)">
            <input
              type="date"
              value={p.regFrom}
              onChange={(e) => applyPresets({ regFrom: e.target.value })}
              className={selectCls}
            />
          </Field>
          <Field label="등록일 (이전)">
            <input
              type="date"
              value={p.regTo}
              onChange={(e) => applyPresets({ regTo: e.target.value })}
              className={selectCls}
            />
          </Field>
          <Field label="누적결제 이상(원)">
            <input
              type="number"
              value={p.paidMin}
              onChange={(e) => setText({ paidMin: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && runText()}
              placeholder="예: 1000000"
              className={`${selectCls} w-36`}
            />
          </Field>
          {hasFilters && (
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex items-center gap-1.5 h-10 px-3 rounded-lg text-[14px] font-medium text-red-600 border border-red-300 bg-bg-card hover:bg-red-50 transition-colors"
            >
              <X className="size-4" strokeWidth={1.75} aria-hidden />
              필터 초기화
            </button>
          )}
        </div>
      </div>

      {/* ── 결과 헤더 ── */}
      <div className="flex items-center justify-between">
        <p className="text-[14px] text-[color:var(--text-muted)]">
          {result ? (
            <>
              <span className="font-medium text-[color:var(--text)]">
                {totalLabel}
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
          columns={result?.columns ?? columns}
          rows={result?.rows ?? []}
          sortColumn={sortColumn}
          sortAsc={sortAsc}
          onSort={onSort}
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
  "h-10 w-44 rounded-lg px-3 bg-bg-card border border-[color:var(--border)] text-[14px] text-[color:var(--text)] placeholder:text-[color:var(--text-dim)] focus:outline-none focus:border-[color:var(--border-strong)]";
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
}: {
  label: string;
  options: ReadonlyArray<string>;
  selected: string[];
  onToggle: (v: string) => void;
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
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ResultsTable({
  columns,
  rows,
  sortColumn,
  sortAsc,
  onSort,
  running,
}: {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  sortColumn: string | undefined;
  sortAsc: boolean;
  onSort: (col: string) => void;
  running: boolean;
}) {
  if (columns.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-bg-card py-16 text-center text-[14px] text-[color:var(--text-muted)]">
        {running ? "불러오는 중…" : "결과가 없습니다."}
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
            {columns.map((c) => {
              const active = sortColumn === c;
              return (
                <th
                  key={c}
                  onClick={() => onSort(c)}
                  className="px-3 py-2 text-left font-medium text-[color:var(--text-muted)] whitespace-nowrap cursor-pointer hover:text-[color:var(--text)] select-none"
                  title={`${c} 정렬`}
                >
                  <span className="inline-flex items-center gap-1">
                    {c}
                    {active &&
                      (sortAsc ? (
                        <ArrowUp className="size-3" strokeWidth={2} aria-hidden />
                      ) : (
                        <ArrowDown
                          className="size-3"
                          strokeWidth={2}
                          aria-hidden
                        />
                      ))}
                  </span>
                </th>
              );
            })}
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
