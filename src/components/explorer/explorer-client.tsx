"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Plus,
  X,
  Loader2,
  Download,
  Play,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  ListFilter,
  Columns3,
} from "lucide-react";
import type { ExplorerDataset } from "@/lib/explorer/datasets";
import {
  EXPLORER_OPERATORS,
  operatorNeedsValue,
  type ExplorerOperator,
} from "@/lib/explorer/datasets";
import {
  describeDatasetAction,
  runExplorerQueryAction,
  type ExplorerRunResult,
} from "@/app/explorer/actions";

interface FilterRow {
  id: number;
  column: string;
  operator: ExplorerOperator;
  value: string;
}

const PAGE_SIZE_OPTIONS = [50, 100, 200, 500] as const;

let filterIdSeq = 1;

/**
 * 데이터 탐색기 본체 (읽기 전용).
 * 데이터셋을 고르면 컬럼을 introspect 해 필터 빌더·컬럼 선택을 구성하고,
 * '조회' 시 서버 액션으로 SELECT 결과를 받아 테이블/CSV 로 보여준다.
 */
export function ExplorerClient({
  datasets,
}: {
  datasets: ReadonlyArray<ExplorerDataset>;
}) {
  const [dataset, setDataset] = useState<string>(datasets[0]?.name ?? "");
  const [columns, setColumns] = useState<string[]>([]);
  const [describing, setDescribing] = useState(false);
  const [filters, setFilters] = useState<FilterRow[]>([]);
  const [display, setDisplay] = useState<string[]>([]); // 빈 배열 = 전체 컬럼
  const [columnPanelOpen, setColumnPanelOpen] = useState(false);
  const [sortColumn, setSortColumn] = useState<string | undefined>(undefined);
  const [sortAsc, setSortAsc] = useState(false);
  const [pageSize, setPageSize] = useState<number>(100);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ExplorerRunResult | null>(null);
  const [running, setRunning] = useState(false);

  const currentDataset = datasets.find((d) => d.name === dataset);

  // 동시 실행 가드 — 마지막 호출만 반영.
  const runSeq = useRef(0);

  interface RunArgs {
    dataset: string;
    filters: FilterRow[];
    display: string[];
    sortColumn: string | undefined;
    sortAsc: boolean;
    page: number;
    pageSize: number;
  }

  const execute = useCallback(async (args: RunArgs) => {
    const seq = ++runSeq.current;
    setRunning(true);
    try {
      const r = await runExplorerQueryAction({
        dataset: args.dataset,
        filters: args.filters.map((f) => ({
          column: f.column,
          operator: f.operator,
          value: f.value,
        })),
        columns: args.display,
        sortColumn: args.sortColumn,
        sortAsc: args.sortAsc,
        page: args.page,
        pageSize: args.pageSize,
      });
      if (seq === runSeq.current) setResult(r);
    } finally {
      if (seq === runSeq.current) setRunning(false);
    }
  }, []);

  // 데이터셋 선택 → 컬럼 introspect + 상태 리셋 + 첫 페이지 자동 조회.
  const selectDataset = useCallback(
    async (name: string) => {
      setDataset(name);
      setFilters([]);
      setDisplay([]);
      setColumnPanelOpen(false);
      setSortColumn(undefined);
      setSortAsc(false);
      setPage(1);
      setResult(null);
      setColumns([]);
      setDescribing(true);
      const d = await describeDatasetAction(name);
      setDescribing(false);
      if (d.ok) setColumns(d.columns);
      await execute({
        dataset: name,
        filters: [],
        display: [],
        sortColumn: undefined,
        sortAsc: false,
        page: 1,
        pageSize,
      });
    },
    [execute, pageSize],
  );

  // 최초 1회 기본 데이터셋 로드.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current || !dataset) return;
    didInit.current = true;
    void selectDataset(dataset);
  }, [dataset, selectDataset]);

  const runCurrent = useCallback(
    (overrides?: Partial<RunArgs>) => {
      void execute({
        dataset,
        filters,
        display,
        sortColumn,
        sortAsc,
        page,
        pageSize,
        ...overrides,
      });
    },
    [execute, dataset, filters, display, sortColumn, sortAsc, page, pageSize],
  );

  // ─── 필터 조작 ────────────────────────────────────────────
  const addFilter = () => {
    if (columns.length === 0) return;
    setFilters((prev) => [
      ...prev,
      { id: filterIdSeq++, column: columns[0], operator: "eq", value: "" },
    ]);
  };
  const updateFilter = (id: number, patch: Partial<FilterRow>) => {
    setFilters((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    );
  };
  const removeFilter = (id: number) => {
    setFilters((prev) => prev.filter((f) => f.id !== id));
  };

  // ─── 정렬 (헤더 클릭) ─────────────────────────────────────
  const onSort = (col: string) => {
    const asc = sortColumn === col ? !sortAsc : false;
    setSortColumn(col);
    setSortAsc(asc);
    setPage(1);
    runCurrent({ sortColumn: col, sortAsc: asc, page: 1 });
  };

  // ─── 페이지 이동 ──────────────────────────────────────────
  const goPage = (next: number) => {
    if (next < 1) return;
    setPage(next);
    runCurrent({ page: next });
  };

  // ─── 표시 컬럼 토글 ───────────────────────────────────────
  const toggleDisplay = (col: string) => {
    setDisplay((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col],
    );
  };

  // ─── 조회 버튼 (필터/컬럼 적용, 페이지 1) ─────────────────
  const onRun = () => {
    setPage(1);
    runCurrent({ page: 1 });
  };

  // ─── CSV 내보내기 (현재 결과 행) ──────────────────────────
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
    a.download = `${dataset}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalLabel =
    result?.total != null
      ? `약 ${result.total.toLocaleString()}건`
      : "건수 미상";

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      {/* ── 데이터셋 선택 ── */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-[color:var(--text-muted)]">
            데이터셋
          </span>
          <select
            value={dataset}
            onChange={(e) => void selectDataset(e.target.value)}
            className="h-10 min-w-64 rounded-lg px-3 bg-bg-card border border-[color:var(--border)] text-[14px] text-[color:var(--text)] focus:outline-none focus:border-[color:var(--border-strong)] cursor-pointer"
          >
            {datasets.map((d) => (
              <option key={d.name} value={d.name}>
                {d.label} ({d.name})
              </option>
            ))}
          </select>
        </label>
        {currentDataset && (
          <p className="pb-2 text-[12px] text-[color:var(--text-dim)] max-w-md">
            {currentDataset.note}
          </p>
        )}
      </div>

      {/* ── 필터 빌더 ── */}
      <div className="rounded-xl border border-[color:var(--border)] bg-bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ListFilter
            className="size-4 text-[color:var(--text-muted)]"
            strokeWidth={1.75}
            aria-hidden
          />
          <span className="text-[13px] font-medium text-[color:var(--text)]">
            필터
          </span>
          <span className="text-[12px] text-[color:var(--text-dim)]">
            모두 AND 조건
          </span>
        </div>

        {filters.length === 0 && (
          <p className="text-[13px] text-[color:var(--text-dim)]">
            필터 없음 — 전체 조회. 아래 “필터 추가”로 조건을 막 붙여보세요.
          </p>
        )}

        <div className="space-y-2">
          {filters.map((f) => {
            const needsValue = operatorNeedsValue(f.operator);
            return (
              <div key={f.id} className="flex flex-wrap items-center gap-2">
                <select
                  value={f.column}
                  onChange={(e) =>
                    updateFilter(f.id, { column: e.target.value })
                  }
                  className="h-9 min-w-44 rounded-md px-2 bg-bg-card border border-[color:var(--border)] text-[13px] text-[color:var(--text)] focus:outline-none focus:border-[color:var(--border-strong)]"
                >
                  {columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <select
                  value={f.operator}
                  onChange={(e) =>
                    updateFilter(f.id, {
                      operator: e.target.value as ExplorerOperator,
                    })
                  }
                  className="h-9 min-w-32 rounded-md px-2 bg-bg-card border border-[color:var(--border)] text-[13px] text-[color:var(--text)] focus:outline-none focus:border-[color:var(--border-strong)]"
                >
                  {EXPLORER_OPERATORS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={f.value}
                  disabled={!needsValue}
                  onChange={(e) =>
                    updateFilter(f.id, { value: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onRun();
                  }}
                  placeholder={needsValue ? "값" : "(값 불필요)"}
                  className="h-9 min-w-48 flex-1 rounded-md px-2.5 bg-bg-card border border-[color:var(--border)] text-[13px] text-[color:var(--text)] placeholder:text-[color:var(--text-dim)] focus:outline-none focus:border-[color:var(--border-strong)] disabled:bg-[color:var(--bg-muted)] disabled:text-[color:var(--text-dim)]"
                />
                <button
                  type="button"
                  onClick={() => removeFilter(f.id)}
                  aria-label="필터 제거"
                  className="inline-flex items-center justify-center size-9 rounded-md text-[color:var(--text-muted)] hover:text-[color:var(--text)] hover:bg-[color:var(--bg-hover)]"
                >
                  <X className="size-4" strokeWidth={1.75} aria-hidden />
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={addFilter}
            disabled={columns.length === 0}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-medium bg-bg-card text-[color:var(--text)] border border-[color:var(--border)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--bg-hover)] disabled:opacity-50 transition-colors"
          >
            <Plus className="size-4" strokeWidth={1.75} aria-hidden />
            필터 추가
          </button>

          <button
            type="button"
            onClick={() => setColumnPanelOpen((o) => !o)}
            disabled={columns.length === 0}
            aria-expanded={columnPanelOpen}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-medium bg-bg-card text-[color:var(--text-muted)] border border-[color:var(--border)] hover:text-[color:var(--text)] hover:bg-[color:var(--bg-hover)] disabled:opacity-50 transition-colors"
          >
            <Columns3 className="size-4" strokeWidth={1.75} aria-hidden />
            표시 컬럼
            {display.length > 0 && (
              <span className="ml-0.5 tabular-nums">({display.length})</span>
            )}
          </button>

          <select
            value={pageSize}
            onChange={(e) => {
              const ps = Number(e.target.value);
              setPageSize(ps);
              setPage(1);
              runCurrent({ pageSize: ps, page: 1 });
            }}
            aria-label="페이지당 행 수"
            className="h-9 rounded-lg px-2 bg-bg-card border border-[color:var(--border)] text-[13px] text-[color:var(--text)] cursor-pointer"
          >
            {PAGE_SIZE_OPTIONS.map((ps) => (
              <option key={ps} value={ps}>
                {ps}행씩
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={onRun}
            disabled={running || describing}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-semibold bg-[color:var(--action)] text-[color:var(--action-text)] hover:bg-[color:var(--action-hover)] disabled:opacity-60 transition-colors"
          >
            {running ? (
              <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
            ) : (
              <Play className="size-4" strokeWidth={2} aria-hidden />
            )}
            조회
          </button>

          <button
            type="button"
            onClick={exportCsv}
            disabled={!result || result.rows.length === 0}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-medium bg-bg-card text-[color:var(--text)] border border-[color:var(--border)] hover:bg-[color:var(--bg-hover)] disabled:opacity-50 transition-colors"
            title="현재 페이지 결과를 CSV 로 내려받습니다(Excel 호환)"
          >
            <Download className="size-4" strokeWidth={1.75} aria-hidden />
            CSV
          </button>
        </div>

        {/* 표시 컬럼 패널 */}
        {columnPanelOpen && columns.length > 0 && (
          <div className="mt-1 rounded-lg bg-[color:var(--bg-muted)] p-3">
            <div className="mb-2 flex items-center gap-3 text-[12px] text-[color:var(--text-muted)]">
              <span>표시할 컬럼을 고르세요. (선택 없으면 전체)</span>
              <button
                type="button"
                onClick={() => setDisplay([])}
                className="underline hover:text-[color:var(--text)]"
              >
                전체 표시
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
              {columns.map((c) => {
                const on = display.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggleDisplay(c)}
                    aria-pressed={on}
                    className={`inline-flex items-center h-7 px-2.5 rounded-full text-[12px] border transition-colors ${
                      on
                        ? "bg-[color:var(--action)] text-[color:var(--action-text)] border-[color:var(--action)]"
                        : "bg-bg-card text-[color:var(--text-muted)] border-[color:var(--border)] hover:bg-[color:var(--bg-hover)]"
                    }`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── 결과 ── */}
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-[color:var(--text-muted)]">
          {describing
            ? "컬럼 불러오는 중…"
            : result
              ? `${totalLabel} · ${result.rows.length}행 표시 (${result.page}페이지)`
              : "—"}
        </p>
      </div>

      {result?.error ? (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-[14px] text-red-700">
          {result.error}
        </div>
      ) : (
        <ResultsTable
          columns={result?.columns ?? []}
          rows={result?.rows ?? []}
          sortColumn={sortColumn}
          sortAsc={sortAsc}
          onSort={onSort}
          running={running}
        />
      )}

      {/* ── 페이지네이션 ── */}
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
