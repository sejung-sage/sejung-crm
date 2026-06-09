"use client";

import { CheckCircle2, XCircle, Copy, BellOff } from "lucide-react";
import { formatPhone } from "@/lib/phone";
import {
  summarize,
  type ExcelRowStatus,
  type ParsedRecipientRow,
} from "./excel-parse";

interface Props {
  rows: ParsedRecipientRow[];
}

const STATUS_META: Record<
  ExcelRowStatus,
  {
    label: string;
    icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
    tone: string;
    excluded: boolean;
  }
> = {
  ok: {
    label: "정상",
    icon: CheckCircle2,
    tone: "text-[color:var(--success)]",
    excluded: false,
  },
  invalid: {
    label: "잘못된 번호",
    icon: XCircle,
    tone: "text-[color:var(--danger)]",
    excluded: true,
  },
  duplicate: {
    label: "중복",
    icon: Copy,
    tone: "text-[color:var(--text-muted)]",
    excluded: true,
  },
  unsubscribed: {
    label: "수신거부",
    icon: BellOff,
    tone: "text-[color:var(--warning)]",
    excluded: true,
  },
};

/**
 * 엑셀 보내기 ③ 미리보기 표 + 상단 요약.
 *
 * - 컬럼: 번호 · 이름 · 연락처 · 상태.
 * - 제외 대상(잘못된 번호/중복/수신거부)은 회색·취소선으로 구분.
 * - 5,000행까지 가정 — 스크롤 영역 + sticky 헤더만으로 처리(가상스크롤 불필요).
 */
export function ExcelRecipientsPreview({ rows }: Props) {
  if (rows.length === 0) return null;

  const s = summarize(rows);
  const excludedTotal = s.invalid + s.duplicate + s.unsubscribed;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
          3. 발송 대상 확인
        </h2>
        <p className="text-[13px] text-[color:var(--text-muted)]" aria-live="polite">
          발송{" "}
          <span className="font-semibold text-[color:var(--text)] tabular-nums">
            {s.sendable.toLocaleString()}
          </span>
          명 · 제외{" "}
          <span className="font-semibold text-[color:var(--text)] tabular-nums">
            {excludedTotal.toLocaleString()}
          </span>
          명
          {excludedTotal > 0 && (
            <span className="text-[color:var(--text-muted)]">
              {" "}
              (잘못된 번호 {s.invalid.toLocaleString()} · 중복{" "}
              {s.duplicate.toLocaleString()} · 수신거부{" "}
              {s.unsubscribed.toLocaleString()})
            </span>
          )}
        </p>
      </div>

      <div className="rounded-xl border border-[color:var(--border)] overflow-hidden">
        <div className="max-h-[420px] overflow-y-auto">
          <table className="w-full border-collapse text-[14px]">
            <thead className="sticky top-0 z-10 bg-[color:var(--bg-muted)]">
              <tr className="text-left text-[13px] font-medium text-[color:var(--text-muted)]">
                <th className="px-4 py-2.5 w-14 text-right tabular-nums">#</th>
                <th className="px-4 py-2.5">이름</th>
                <th className="px-4 py-2.5">연락처</th>
                <th className="px-4 py-2.5 w-32">상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const meta = STATUS_META[row.status];
                const Icon = meta.icon;
                const muted = meta.excluded;
                return (
                  <tr
                    key={`${row.phone}-${row.index}-${i}`}
                    className="border-t border-[color:var(--border)] hover:bg-[color:var(--bg-hover)]"
                  >
                    <td className="px-4 py-2.5 text-right tabular-nums text-[color:var(--text-dim)]">
                      {i + 1}
                    </td>
                    <td
                      className={`px-4 py-2.5 ${
                        muted
                          ? "text-[color:var(--text-dim)] line-through"
                          : "text-[color:var(--text)]"
                      }`}
                    >
                      {row.name || (
                        <span className="text-[color:var(--text-dim)]">
                          (이름 없음)
                        </span>
                      )}
                    </td>
                    <td
                      className={`px-4 py-2.5 tabular-nums ${
                        muted
                          ? "text-[color:var(--text-dim)] line-through"
                          : "text-[color:var(--text)]"
                      }`}
                    >
                      {formatPhone(row.phone) || row.rawPhone || "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1.5 text-[13px] ${meta.tone}`}
                      >
                        <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
                        {meta.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
