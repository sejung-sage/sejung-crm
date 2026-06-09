"use client";

import { useRef, useState, useTransition } from "react";
import { Download, Upload, FileSpreadsheet, AlertTriangle } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { checkUnsubscribedPhonesAction } from "@/app/(features)/excel-send/actions";
import {
  applyUnsubscribed,
  extractRecipients,
  type ParsedRecipientRow,
} from "./excel-parse";

interface Props {
  /**
   * 파싱·검증·수신거부 반영이 끝난 행 목록을 부모에 전달.
   * 두 번째 인자는 업로드한 파일명(파싱 성공 시) — 실패 시 생략.
   */
  onParsed: (rows: ParsedRecipientRow[], fileName?: string) => void;
  /** 현재 업로드된 파일명(없으면 null). 미리보기 헤더 표기용. */
  fileName: string | null;
}

const ACCEPT = ".xlsx,.xls";

/**
 * 엑셀 보내기 ① 양식 다운로드 + ② 업로드/파싱 패널.
 *
 * - 양식 다운로드: xlsx 동적 import 로 헤더(이름/연락처) + 예시 2행 파일 생성.
 * - 업로드: 파일 선택 또는 드롭 → xlsx 동적 import 로 첫 시트 파싱 →
 *   이름/연락처 추출 → 번호 검증·중복 표시 → 정상 번호로 수신거부 조회.
 */
export function ExcelUploadPanel({ onParsed, fileName }: Props) {
  const { show } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [parsing, startParsing] = useTransition();
  const [dragOver, setDragOver] = useState(false);

  const busy = parsing;

  // ── 양식 다운로드 ──────────────────────────────────────────
  const handleDownloadTemplate = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const XLSX = await import("xlsx");
      const rows = [
        { 이름: "김철수", 연락처: "010-1234-5678" },
        { 이름: "이영희", 연락처: "01087654321" },
      ];
      const ws = XLSX.utils.json_to_sheet(rows, { header: ["이름", "연락처"] });
      ws["!cols"] = [{ wch: 12 }, { wch: 18 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "명단");
      XLSX.writeFile(wb, "엑셀발송_양식.xlsx");
    } catch {
      show("error", "양식 파일을 만들지 못했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setDownloading(false);
    }
  };

  // ── 파일 파싱 ──────────────────────────────────────────────
  const handleFile = (file: File) => {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
      show("error", "엑셀 파일(.xlsx, .xls)만 올릴 수 있습니다.");
      return;
    }

    startParsing(async () => {
      try {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const firstSheet = wb.SheetNames[0];
        const sheet = firstSheet ? wb.Sheets[firstSheet] : undefined;
        if (!sheet) {
          show("error", "시트를 찾지 못했습니다. 명단이 담긴 엑셀인지 확인해주세요.");
          return;
        }
        const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          defval: "",
          raw: false,
          blankrows: false,
        });

        const result = extractRecipients(aoa);
        if (!result.ok) {
          onParsed([]);
          show("error", result.reason);
          return;
        }

        // 정상 번호만 모아 수신거부 조회. (서버가 최종 가드이지만 미리보기에 표시)
        const okPhones = result.rows
          .filter((r) => r.status === "ok")
          .map((r) => r.phone);

        let finalRows = result.rows;
        if (okPhones.length > 0) {
          const res = await checkUnsubscribedPhonesAction(okPhones);
          if (res.status === "success") {
            finalRows = applyUnsubscribed(
              result.rows,
              new Set(res.unsubscribed),
            );
          } else {
            // 수신거부 조회 실패는 발송을 막지 않는다(서버가 최종 가드).
            show(
              "error",
              "수신거부 명단 확인에 실패했어요. 그대로 진행해도 발송 시 서버에서 다시 걸러집니다.",
            );
          }
        }

        onParsed(finalRows, file.name);
      } catch {
        onParsed([]);
        show("error", "엑셀을 읽지 못했습니다. 파일이 손상되지 않았는지 확인해주세요.");
      }
    });
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // 같은 파일 재선택 허용을 위해 값 초기화.
    e.target.value = "";
  };

  return (
    <section className="space-y-4">
      {/* ① 양식 안내 + 다운로드 */}
      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-card)] p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
              1. 양식 내려받기
            </h2>
            <p className="text-[13px] text-[color:var(--text-muted)] leading-relaxed">
              <span className="font-medium text-[color:var(--text)]">이름</span>,{" "}
              <span className="font-medium text-[color:var(--text)]">연락처</span>{" "}
              두 열로 된 양식입니다. 연락처는{" "}
              <code className="px-1 rounded bg-[color:var(--bg-muted)]">
                010-1234-5678
              </code>{" "}
              또는{" "}
              <code className="px-1 rounded bg-[color:var(--bg-muted)]">
                01012345678
              </code>{" "}
              형식으로 입력하세요.
            </p>
          </div>
          <button
            type="button"
            onClick={handleDownloadTemplate}
            disabled={downloading}
            className="
              inline-flex shrink-0 items-center justify-center gap-1.5
              h-10 px-4 rounded-lg
              text-[14px] font-medium
              text-[color:var(--text)]
              border border-[color:var(--border)] bg-[color:var(--bg-card)]
              hover:bg-[color:var(--bg-hover)]
              focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--action)] focus-visible:ring-offset-1
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors
            "
          >
            <Download className="size-4" strokeWidth={1.75} aria-hidden />
            {downloading ? "준비 중..." : "양식 다운로드"}
          </button>
        </div>
      </div>

      {/* ② 업로드 / 드롭존 */}
      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-card)] p-5 space-y-3">
        <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
          2. 명단 올리기
        </h2>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleFile(file);
          }}
          className={`
            flex flex-col items-center justify-center gap-3
            rounded-xl border-2 border-dashed
            px-6 py-10 text-center
            transition-colors
            ${
              dragOver
                ? "border-[color:var(--action)] bg-[color:var(--bg-muted)]"
                : "border-[color:var(--border)] bg-[color:var(--bg-muted)]"
            }
          `}
        >
          <FileSpreadsheet
            className="size-8 text-[color:var(--text-muted)]"
            strokeWidth={1.5}
            aria-hidden
          />
          <div className="space-y-0.5">
            <p className="text-[14px] text-[color:var(--text)]">
              엑셀 파일을 여기로 끌어다 놓거나 아래 버튼으로 선택하세요.
            </p>
            <p className="text-[12px] text-[color:var(--text-muted)]">
              .xlsx, .xls 형식 · 첫 시트의 이름·연락처 열을 읽습니다.
            </p>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            onChange={onInputChange}
            className="sr-only"
            aria-label="엑셀 파일 선택"
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="
              inline-flex items-center justify-center gap-1.5
              h-10 px-4 rounded-lg
              text-[14px] font-medium
              text-[color:var(--action-text)]
              bg-[color:var(--action)]
              hover:bg-[color:var(--action-hover)]
              focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--action)] focus-visible:ring-offset-1
              disabled:opacity-50 disabled:cursor-not-allowed
              transition
            "
          >
            <Upload className="size-4" strokeWidth={1.75} aria-hidden />
            {busy ? "읽는 중..." : "파일 선택"}
          </button>

          {fileName && !busy && (
            <p className="text-[13px] text-[color:var(--text-muted)]">
              올린 파일:{" "}
              <span className="font-medium text-[color:var(--text)]">
                {fileName}
              </span>
            </p>
          )}
        </div>

        <p className="flex items-start gap-1.5 text-[12px] text-[color:var(--text-muted)]">
          <AlertTriangle
            className="size-3.5 mt-0.5 shrink-0"
            strokeWidth={1.75}
            aria-hidden
          />
          잘못된 번호·중복·수신거부 번호는 미리보기에서 자동으로 표시되고 발송에서
          제외됩니다.
        </p>
      </div>
    </section>
  );
}
