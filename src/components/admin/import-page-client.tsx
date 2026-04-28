"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";
import type {
  ImportApplyResult,
  ImportCombinedReport,
  ImportKind,
  ImportValidationReport,
  RowError,
} from "@/types/import";
import {
  commitImportAction,
  dryRunImportAction,
} from "@/app/(features)/admin/import/actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * F1-03 · Aca2000 import 클라이언트 UI.
 *
 * 3단 드롭존 → 미리보기(dry-run) → 확정(commit) → 적용 결과 표시.
 * 파일 선택·검증 결과 렌더·실패 행 CSV 다운로드 전부 여기서 처리.
 * 실제 파싱/검증/적용은 Server Action 에 위임.
 */

type DropzoneKey = ImportKind;

const DROPZONES: Array<{
  key: DropzoneKey;
  label: string;
  hint: string;
}> = [
  { key: "students", label: "학생", hint: "students.csv · students.xlsx" },
  {
    key: "enrollments",
    label: "수강 이력",
    hint: "enrollments.csv · enrollments.xlsx",
  },
  {
    key: "attendances",
    label: "출석",
    hint: "attendances.csv · attendances.xlsx",
  },
];

const KIND_LABEL: Record<ImportKind, string> = {
  students: "학생",
  enrollments: "수강 이력",
  attendances: "출석",
};

export function ImportPageClient() {
  const [files, setFiles] = useState<Record<DropzoneKey, File | null>>({
    students: null,
    enrollments: null,
    attendances: null,
  });
  const [upsertMode, setUpsertMode] = useState<boolean>(true);
  const [report, setReport] = useState<ImportCombinedReport | null>(null);
  const [applyResult, setApplyResult] = useState<ImportApplyResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState<boolean>(false);
  const [isPreviewing, startPreviewTransition] = useTransition();
  const [isCommitting, startCommitTransition] = useTransition();

  const hasAnyFile = useMemo(
    () => Object.values(files).some((f) => f !== null),
    [files],
  );

  const setFile = useCallback((key: DropzoneKey, file: File | null) => {
    setFiles((prev) => ({ ...prev, [key]: file }));
    // 파일을 바꾸면 기존 리포트·결과는 무효화
    setReport(null);
    setApplyResult(null);
    setPreviewError(null);
  }, []);

  const handlePreview = () => {
    if (!hasAnyFile) return;
    setPreviewError(null);
    setApplyResult(null);

    const formData = new FormData();
    if (files.students) formData.append("students", files.students);
    if (files.enrollments) formData.append("enrollments", files.enrollments);
    if (files.attendances) formData.append("attendances", files.attendances);

    startPreviewTransition(async () => {
      try {
        const result = await dryRunImportAction(formData);
        setReport(result);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "알 수 없는 오류";
        setPreviewError(
          `미리보기 중 오류가 발생했습니다. 파일 형식을 확인해주세요. (${msg})`,
        );
      }
    });
  };

  const handleCommitConfirm = () => {
    if (!report || !report.summary.canCommit) return;

    startCommitTransition(async () => {
      try {
        const result = await commitImportAction(report, {
          upsertMode: upsertMode ? "upsert" : "insert_only",
        });
        setApplyResult(result);
        setConfirmOpen(false);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "알 수 없는 오류";
        setApplyResult({ status: "failed", reason: msg });
        setConfirmOpen(false);
      }
    });
  };

  const handleRetry = () => {
    setApplyResult(null);
  };

  // 적용 결과 화면
  if (applyResult) {
    return (
      <ApplyResultCard
        result={applyResult}
        onRetry={handleRetry}
      />
    );
  }

  return (
    <div className="space-y-8">
      {/* 3단 드롭존 */}
      <section aria-labelledby="upload-section-title" className="space-y-4">
        <h2
          id="upload-section-title"
          className="text-[16px] font-semibold text-[color:var(--text)]"
        >
          1. 파일 업로드
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
          {DROPZONES.map((zone) => (
            <Dropzone
              key={zone.key}
              label={zone.label}
              hint={zone.hint}
              file={files[zone.key]}
              onChange={(f) => setFile(zone.key, f)}
            />
          ))}
        </div>

        {/* 업서트 체크박스 + 미리보기 버튼 */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
          <label className="inline-flex items-center gap-2 text-[14px] text-[color:var(--text)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={upsertMode}
              onChange={(e) => setUpsertMode(e.target.checked)}
              className="size-4 accent-[color:var(--action)]"
            />
            <span>기존 학생 덮어쓰기 (upsert)</span>
            <span className="text-[13px] text-[color:var(--text-muted)]">
              · 체크 해제 시 신규 학생만 등록합니다
            </span>
          </label>

          <button
            type="button"
            onClick={handlePreview}
            disabled={!hasAnyFile || isPreviewing}
            className="
              inline-flex items-center justify-center gap-2
              h-10 px-5 rounded-lg
              bg-[color:var(--action)] text-[color:var(--action-text)]
              text-[15px] font-medium
              hover:bg-[color:var(--action-hover)]
              disabled:bg-[color:var(--bg-hover)]
              disabled:text-[color:var(--text-dim)]
              disabled:cursor-not-allowed
              transition-colors
            "
          >
            {isPreviewing ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Upload className="size-4" strokeWidth={2} aria-hidden />
            )}
            {isPreviewing ? "미리보기 중..." : "미리보기"}
          </button>
        </div>

        {previewError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-[color:var(--danger)] bg-[color:var(--danger-bg)] p-3 text-[14px] text-[color:var(--danger)]"
          >
            <AlertCircle
              className="size-4 mt-0.5 shrink-0"
              strokeWidth={2}
              aria-hidden
            />
            <span>{previewError}</span>
          </div>
        )}
      </section>

      {/* 미리보기 리포트 */}
      {report && (
        <ReportView
          report={report}
          canCommit={report.summary.canCommit}
          onCommit={() => setConfirmOpen(true)}
        />
      )}

      {/* 확정 다이얼로그 */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>데이터를 적용할까요?</DialogTitle>
            <DialogDescription>
              {report
                ? `학생 ${report.summary.totalStudents.toLocaleString()}명, 수강 ${report.summary.totalEnrollments.toLocaleString()}건, 출석 ${report.summary.totalAttendances.toLocaleString()}건을 적용합니다. 계속하시겠어요?`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              disabled={isCommitting}
              className="
                inline-flex items-center h-10 px-4 rounded-lg
                border border-[color:var(--border)]
                text-[14px] text-[color:var(--text)]
                hover:bg-[color:var(--bg-hover)]
                transition-colors
                disabled:opacity-50
              "
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleCommitConfirm}
              disabled={isCommitting}
              className="
                inline-flex items-center justify-center gap-2
                h-10 px-5 rounded-lg
                bg-[color:var(--action)] text-[color:var(--action-text)]
                text-[14px] font-medium
                hover:bg-[color:var(--action-hover)]
                disabled:opacity-60
                transition-colors
              "
            >
              {isCommitting && (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              )}
              {isCommitting ? "적용 중..." : "적용하기"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── 드롭존 ───────────────────────────────────────────────

function Dropzone({
  label,
  hint,
  file,
  onChange,
}: {
  label: string;
  hint: string;
  file: File | null;
  onChange: (f: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState<boolean>(false);
  const inputId = `file-${label}`;

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) onChange(dropped);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[14px] font-semibold text-[color:var(--text)]">
        {label}
      </span>

      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          relative rounded-xl border-2 border-dashed
          min-h-[160px] p-4
          flex flex-col items-center justify-center text-center
          transition-colors
          ${
            dragOver
              ? "border-[color:var(--action)] bg-[color:var(--bg-hover)]"
              : "border-[color:var(--border-strong)] bg-[color:var(--bg-muted)] hover:border-[color:var(--text-muted)]"
          }
        `}
      >
        {file ? (
          <div className="w-full flex items-center gap-3">
            <FileSpreadsheet
              className="size-8 shrink-0 text-[color:var(--text-muted)]"
              strokeWidth={1.5}
              aria-hidden
            />
            <div className="flex-1 min-w-0 text-left">
              <p className="truncate text-[14px] font-medium text-[color:var(--text)]">
                {file.name}
              </p>
              <p className="text-[12px] text-[color:var(--text-muted)]">
                {formatFileSize(file.size)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                onChange(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
              aria-label={`${label} 파일 제거`}
              className="
                inline-flex items-center justify-center
                size-8 rounded-md
                text-[color:var(--text-muted)]
                hover:bg-[color:var(--bg-hover)]
                hover:text-[color:var(--text)]
                transition-colors
              "
            >
              <X className="size-4" strokeWidth={2} aria-hidden />
            </button>
          </div>
        ) : (
          <>
            <FileSpreadsheet
              className="size-10 text-[color:var(--text-dim)] mb-2"
              strokeWidth={1.25}
              aria-hidden
            />
            <p className="text-[14px] text-[color:var(--text)]">
              드래그하거나 파일 선택
            </p>
            <p className="mt-1 text-[12px] text-[color:var(--text-muted)]">
              {hint}
            </p>
            <label
              htmlFor={inputId}
              className="
                mt-3 inline-flex items-center justify-center
                h-9 px-3 rounded-md
                border border-[color:var(--border)]
                bg-[color:var(--bg)]
                text-[13px] font-medium text-[color:var(--text)]
                hover:bg-[color:var(--bg-hover)]
                cursor-pointer
                transition-colors
              "
            >
              파일 선택
            </label>
          </>
        )}
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="sr-only"
          onChange={(e) => {
            const selected = e.target.files?.[0] ?? null;
            onChange(selected);
          }}
        />
      </div>
    </div>
  );
}

// ─── 리포트 ───────────────────────────────────────────────

function ReportView({
  report,
  canCommit,
  onCommit,
}: {
  report: ImportCombinedReport;
  canCommit: boolean;
  onCommit: () => void;
}) {
  return (
    <section aria-labelledby="report-section-title" className="space-y-5">
      <h2
        id="report-section-title"
        className="text-[16px] font-semibold text-[color:var(--text)]"
      >
        2. 미리보기 결과
      </h2>

      {/* 요약 KPI 4개 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard
          label="학생"
          value={report.summary.totalStudents}
          suffix="명"
        />
        <SummaryCard
          label="수강 이력"
          value={report.summary.totalEnrollments}
          suffix="건"
        />
        <SummaryCard
          label="출석"
          value={report.summary.totalAttendances}
          suffix="건"
        />
        <SummaryCard
          label="오류"
          value={report.summary.totalErrors}
          suffix="건"
          tone={report.summary.totalErrors > 0 ? "danger" : "default"}
        />
      </div>

      {/* 파일별 상세 */}
      <div className="space-y-3">
        {(["students", "enrollments", "attendances"] as const).map((kind) => {
          const r = report[kind];
          if (!r) return null;
          return <FileSection key={kind} report={r} />;
        })}
      </div>

      {/* crossErrors */}
      {report.crossErrors.length > 0 && (
        <CrossErrorSection errors={report.crossErrors} />
      )}

      {/* 확정 버튼 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 border-t border-[color:var(--border)]">
        <div className="text-[13px] text-[color:var(--text-muted)]">
          {canCommit
            ? "오류가 없거나 허용 범위 내입니다. 확정하면 데이터베이스에 적용됩니다."
            : "오류를 먼저 해결해야 적용할 수 있습니다. 실패 행 CSV 를 내려받아 수정 후 다시 업로드하세요."}
        </div>
        <button
          type="button"
          onClick={onCommit}
          disabled={!canCommit}
          className="
            inline-flex items-center justify-center gap-2
            h-10 px-5 rounded-lg
            bg-[color:var(--action)] text-[color:var(--action-text)]
            text-[15px] font-medium
            hover:bg-[color:var(--action-hover)]
            disabled:bg-[color:var(--bg-hover)]
            disabled:text-[color:var(--text-dim)]
            disabled:cursor-not-allowed
            transition-colors
          "
        >
          <CheckCircle2 className="size-4" strokeWidth={2} aria-hidden />
          확정하고 적용하기
        </button>
      </div>
    </section>
  );
}

function SummaryCard({
  label,
  value,
  suffix,
  tone = "default",
}: {
  label: string;
  value: number;
  suffix: string;
  tone?: "default" | "danger";
}) {
  return (
    <div
      className={`
        rounded-xl border p-4
        ${
          tone === "danger" && value > 0
            ? "border-[color:var(--danger)] bg-[color:var(--danger-bg)]"
            : "border-[color:var(--border)] bg-[color:var(--bg)]"
        }
      `}
    >
      <div
        className={`
          text-[13px] font-medium
          ${
            tone === "danger" && value > 0
              ? "text-[color:var(--danger)]"
              : "text-[color:var(--text-muted)]"
          }
        `}
      >
        {label}
      </div>
      <div
        className={`
          mt-1 text-[22px] font-semibold
          ${
            tone === "danger" && value > 0
              ? "text-[color:var(--danger)]"
              : "text-[color:var(--text)]"
          }
        `}
      >
        {value.toLocaleString()}
        <span className="ml-1 text-[14px] font-normal">{suffix}</span>
      </div>
    </div>
  );
}

function FileSection({ report }: { report: ImportValidationReport }) {
  const [expanded, setExpanded] = useState<boolean>(report.errors.length > 0);
  const title = KIND_LABEL[report.kind];
  const hasErrors = report.errors.length > 0;

  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[color:var(--border)]">
        <div className="flex items-center gap-2">
          <FileSpreadsheet
            className="size-[18px] text-[color:var(--text-muted)]"
            strokeWidth={1.75}
            aria-hidden
          />
          <span className="text-[15px] font-semibold text-[color:var(--text)]">
            {title}
          </span>
        </div>

        <Badge tone="muted">
          유효 {report.validRows.toLocaleString()} /{" "}
          {report.totalRows.toLocaleString()}
        </Badge>

        {hasErrors ? (
          <Badge tone="danger">오류 {report.errors.length.toLocaleString()}건</Badge>
        ) : (
          <Badge tone="success">오류 없음</Badge>
        )}

        <div className="ml-auto flex items-center gap-2">
          {hasErrors && (
            <button
              type="button"
              onClick={() => downloadErrorsCsv(report)}
              className="
                inline-flex items-center gap-1.5
                h-9 px-3 rounded-md
                border border-[color:var(--border)]
                text-[13px] text-[color:var(--text)]
                hover:bg-[color:var(--bg-hover)]
                transition-colors
              "
            >
              <Download className="size-3.5" strokeWidth={1.75} aria-hidden />
              실패 행 CSV
            </button>
          )}
          {hasErrors && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="
                inline-flex items-center gap-1
                h-9 px-2 rounded-md
                text-[13px] text-[color:var(--text-muted)]
                hover:text-[color:var(--text)]
                hover:bg-[color:var(--bg-hover)]
                transition-colors
              "
            >
              {expanded ? (
                <ChevronDown className="size-4" strokeWidth={1.75} aria-hidden />
              ) : (
                <ChevronRight className="size-4" strokeWidth={1.75} aria-hidden />
              )}
              {expanded ? "접기" : "펼치기"}
            </button>
          )}
        </div>
      </div>

      {hasErrors && expanded && (
        <ErrorsTable errors={report.errors} />
      )}
    </div>
  );
}

function CrossErrorSection({ errors }: { errors: RowError[] }) {
  const [expanded, setExpanded] = useState<boolean>(true);

  return (
    <div className="rounded-xl border border-[color:var(--warning)] bg-[color:var(--warning-bg)]">
      <div className="flex items-center gap-3 px-4 py-3">
        <AlertCircle
          className="size-[18px] text-[color:var(--warning)]"
          strokeWidth={1.75}
          aria-hidden
        />
        <span className="text-[15px] font-semibold text-[color:var(--warning)]">
          학생 매칭 실패 {errors.length.toLocaleString()}건
        </span>
        <span className="text-[13px] text-[color:var(--text-muted)]">
          수강·출석 파일에 있는 학생이 학생 파일에 없습니다.
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="
            ml-auto inline-flex items-center gap-1
            h-9 px-2 rounded-md
            text-[13px] text-[color:var(--text-muted)]
            hover:text-[color:var(--text)]
            hover:bg-[color:var(--bg-hover)]
            transition-colors
          "
        >
          {expanded ? (
            <ChevronDown className="size-4" strokeWidth={1.75} aria-hidden />
          ) : (
            <ChevronRight className="size-4" strokeWidth={1.75} aria-hidden />
          )}
          {expanded ? "접기" : "펼치기"}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-[color:var(--warning)] bg-[color:var(--bg)]">
          <ErrorsTable errors={errors} />
        </div>
      )}
    </div>
  );
}

function ErrorsTable({ errors }: { errors: RowError[] }) {
  const visible = errors.slice(0, 50);
  const rest = errors.length - visible.length;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[14px]">
        <thead className="bg-[color:var(--bg-muted)]">
          <tr>
            <Th className="w-[80px]">행</Th>
            <Th className="w-[160px]">필드</Th>
            <Th>메시지</Th>
            <Th className="w-[200px]">원본값</Th>
          </tr>
        </thead>
        <tbody>
          {visible.map((err, i) => (
            <tr
              key={`${err.row}-${err.field ?? ""}-${i}`}
              className="border-t border-[color:var(--border)] hover:bg-[color:var(--bg-hover)]"
            >
              <Td className="font-mono text-[13px] text-[color:var(--text-muted)]">
                {err.row}
              </Td>
              <Td className="text-[color:var(--text-muted)]">
                {err.field ?? "-"}
              </Td>
              <Td className="text-[color:var(--text)]">{err.message}</Td>
              <Td className="font-mono text-[13px] text-[color:var(--text-muted)] truncate max-w-[200px]">
                {err.rawValue ?? "-"}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
      {rest > 0 && (
        <div className="px-4 py-2 text-[12px] text-[color:var(--text-muted)] border-t border-[color:var(--border)]">
          + {rest.toLocaleString()} 건 더 있음. 전체 확인은 실패 행 CSV 를
          내려받으세요.
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`
        text-left px-4 py-2
        text-[13px] font-medium text-[color:var(--text-muted)]
        ${className}
      `}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-2 align-top ${className}`}>{children}</td>;
}

type BadgeTone = "muted" | "danger" | "success";

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: BadgeTone;
}) {
  const styles: Record<BadgeTone, string> = {
    muted:
      "border-[color:var(--border)] text-[color:var(--text-muted)] bg-[color:var(--bg-muted)]",
    danger:
      "border-[color:var(--danger)] text-[color:var(--danger)] bg-[color:var(--bg)]",
    success:
      "border-[color:var(--success)] text-[color:var(--success)] bg-[color:var(--success-bg)]",
  };
  return (
    <span
      className={`
        inline-flex items-center h-7 px-2.5 rounded-full
        text-[12px] font-medium
        border
        ${styles[tone]}
      `}
    >
      {children}
    </span>
  );
}

// ─── 적용 결과 ────────────────────────────────────────────

function ApplyResultCard({
  result,
  onRetry,
}: {
  result: ImportApplyResult;
  onRetry: () => void;
}) {
  if (result.status === "success") {
    return (
      <div className="rounded-xl border border-[color:var(--success)] bg-[color:var(--success-bg)] p-6 space-y-4">
        <div className="flex items-start gap-3">
          <CheckCircle2
            className="size-6 shrink-0 text-[color:var(--success)]"
            strokeWidth={2}
            aria-hidden
          />
          <div>
            <h2 className="text-[18px] font-semibold text-[color:var(--text)]">
              데이터 적용이 완료되었습니다
            </h2>
            <ul className="mt-2 space-y-0.5 text-[14px] text-[color:var(--text)]">
              <li>
                학생 {result.studentsUpserted.toLocaleString()}명 반영
              </li>
              <li>
                수강 이력 {result.enrollmentsInserted.toLocaleString()}건 추가
              </li>
              <li>
                출석 {result.attendancesInserted.toLocaleString()}건 추가
              </li>
            </ul>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/students"
            className="
              inline-flex items-center h-10 px-4 rounded-lg
              bg-[color:var(--action)] text-[color:var(--action-text)]
              text-[14px] font-medium
              hover:bg-[color:var(--action-hover)]
              transition-colors
            "
          >
            학생 명단으로 이동
          </Link>
          <button
            type="button"
            onClick={onRetry}
            className="
              inline-flex items-center gap-1.5
              h-10 px-4 rounded-lg
              border border-[color:var(--border)]
              bg-[color:var(--bg)]
              text-[14px] text-[color:var(--text)]
              hover:bg-[color:var(--bg-hover)]
              transition-colors
            "
          >
            <RotateCcw className="size-4" strokeWidth={1.75} aria-hidden />
            추가 업로드
          </button>
        </div>
      </div>
    );
  }

  if (result.status === "dev_seed_mode") {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-muted)] p-6 space-y-3">
        <div className="flex items-start gap-3">
          <AlertCircle
            className="size-5 shrink-0 text-[color:var(--text-muted)]"
            strokeWidth={1.75}
            aria-hidden
          />
          <div>
            <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
              개발용 시드 모드
            </h2>
            <p className="mt-1 text-[14px] text-[color:var(--text-muted)]">
              {result.reason}
            </p>
            <p className="mt-2 text-[13px] text-[color:var(--text-muted)]">
              NEXT_PUBLIC_SUPABASE_URL 환경변수를 설정하고 Supabase 에 연결한 뒤
              다시 시도하세요.
            </p>
          </div>
        </div>
        <div>
          <button
            type="button"
            onClick={onRetry}
            className="
              inline-flex items-center gap-1.5
              h-10 px-4 rounded-lg
              border border-[color:var(--border)]
              bg-[color:var(--bg)]
              text-[14px] text-[color:var(--text)]
              hover:bg-[color:var(--bg-hover)]
              transition-colors
            "
          >
            <RotateCcw className="size-4" strokeWidth={1.75} aria-hidden />
            돌아가기
          </button>
        </div>
      </div>
    );
  }

  // failed
  return (
    <div className="rounded-xl border border-[color:var(--danger)] bg-[color:var(--danger-bg)] p-6 space-y-3">
      <div className="flex items-start gap-3">
        <AlertCircle
          className="size-5 shrink-0 text-[color:var(--danger)]"
          strokeWidth={2}
          aria-hidden
        />
        <div>
          <h2 className="text-[16px] font-semibold text-[color:var(--danger)]">
            데이터 적용에 실패했습니다
          </h2>
          <p className="mt-1 text-[14px] text-[color:var(--text)]">
            {result.reason}
          </p>
        </div>
      </div>
      <div>
        <button
          type="button"
          onClick={onRetry}
          className="
            inline-flex items-center gap-1.5
            h-10 px-4 rounded-lg
            bg-[color:var(--action)] text-[color:var(--action-text)]
            text-[14px] font-medium
            hover:bg-[color:var(--action-hover)]
            transition-colors
          "
        >
          <RotateCcw className="size-4" strokeWidth={1.75} aria-hidden />
          다시 시도
        </button>
      </div>
    </div>
  );
}

// ─── 유틸 ────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function escapeCsvCell(value: string | number | undefined | null): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // Excel CSV 표준: 쉼표·따옴표·개행 포함 시 "" 로 감싸고 내부 " 는 "" 로 이스케이프
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadErrorsCsv(report: ImportValidationReport): void {
  const header = ["행", "필드", "메시지", "원본값"];
  const lines = [header.map(escapeCsvCell).join(",")];
  for (const err of report.errors) {
    lines.push(
      [err.row, err.field ?? "", err.message, err.rawValue ?? ""]
        .map(escapeCsvCell)
        .join(","),
    );
  }
  // BOM 추가 (엑셀 한글 깨짐 방지)
  const csv = "﻿" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `import-errors-${report.kind}-${formatDateStamp()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // 다음 틱에 해제
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function formatDateStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}
