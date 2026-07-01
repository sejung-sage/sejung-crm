"use client";

import { Download } from "lucide-react";
import type {
  SendDashboardRow,
  SendDashboardFilters,
} from "@/lib/dashboard/send-dashboard";

/**
 * 발송 대시보드 집계 표 + CSV 내보내기 (클라이언트 — 다운로드 onClick 필요).
 *
 * 첫 컬럼 헤더는 groupBy 에 따라 "월"/"분원"/"발송자" 로 바뀐다.
 * 숫자 컬럼은 우측정렬·천단위 콤마. 행 순서는 RPC 정렬을 그대로 유지.
 * CSV 는 UTF-8 BOM 을 붙여 한글 엑셀에서 깨지지 않게 한다(explorer 관례).
 */

interface Props {
  rows: SendDashboardRow[];
  groupBy: SendDashboardFilters["groupBy"];
}

const GROUP_HEADER: Record<SendDashboardFilters["groupBy"], string> = {
  month: "월",
  branch: "분원",
  sender: "발송자",
};

export function DashboardTable({ rows, groupBy }: Props) {
  const firstHeader = GROUP_HEADER[groupBy];

  const exportCsv = () => {
    if (rows.length === 0) return;
    const esc = (v: string | number): string => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      firstHeader,
      "발송 건수",
      "금액(원)",
      "SMS",
      "LMS",
      "알림톡",
    ];
    const lines = [
      header.join(","),
      ...rows.map((r) =>
        [
          esc(r.groupLabel),
          r.msgCount,
          r.totalCost,
          r.smsCount,
          r.lmsCount,
          r.alimtalkCount,
        ]
          .map((v) => esc(v))
          .join(","),
      ),
    ];
    const blob = new Blob(["﻿" + lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `send_dashboard_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const numCls =
    "px-4 py-3 text-right text-[15px] text-[color:var(--text)] tabular-nums";

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={exportCsv}
          disabled={rows.length === 0}
          title="현재 표시 중인 집계를 CSV 로 내려받습니다(Excel 호환)"
          className="
            inline-flex items-center gap-1.5 h-10 px-3 rounded-lg
            text-[14px] font-medium
            bg-bg-card text-[color:var(--text)]
            border border-[color:var(--border)]
            hover:bg-[color:var(--bg-hover)] hover:border-[color:var(--border-strong)]
            focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--border-strong)]
            disabled:opacity-40 disabled:cursor-not-allowed
            transition-colors
          "
        >
          <Download className="size-4" strokeWidth={1.75} aria-hidden />
          CSV 내보내기
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[color:var(--border)] bg-bg-card">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[color:var(--border)]">
              <th className="px-4 py-3 text-left text-[13px] font-medium text-[color:var(--text-muted)]">
                {firstHeader}
              </th>
              <th className="px-4 py-3 text-right text-[13px] font-medium text-[color:var(--text-muted)]">
                발송 건수
              </th>
              <th className="px-4 py-3 text-right text-[13px] font-medium text-[color:var(--text-muted)]">
                금액(원)
              </th>
              <th className="px-4 py-3 text-right text-[13px] font-medium text-[color:var(--text-muted)]">
                SMS
              </th>
              <th className="px-4 py-3 text-right text-[13px] font-medium text-[color:var(--text-muted)]">
                LMS
              </th>
              <th className="px-4 py-3 text-right text-[13px] font-medium text-[color:var(--text-muted)]">
                알림톡
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-12 text-center text-[15px] text-[color:var(--text-muted)]"
                >
                  해당 조건의 발송 내역이 없습니다
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.groupKey}
                  className="border-b border-[color:var(--border)] last:border-0 hover:bg-[color:var(--bg-hover)]"
                >
                  <td className="px-4 py-3 text-[15px] text-[color:var(--text)]">
                    {r.groupLabel}
                  </td>
                  <td className={numCls}>
                    {r.msgCount.toLocaleString("ko-KR")}
                  </td>
                  <td className={numCls}>
                    {r.totalCost.toLocaleString("ko-KR")}
                  </td>
                  <td className={numCls}>
                    {r.smsCount.toLocaleString("ko-KR")}
                  </td>
                  <td className={numCls}>
                    {r.lmsCount.toLocaleString("ko-KR")}
                  </td>
                  <td className={numCls}>
                    {r.alimtalkCount.toLocaleString("ko-KR")}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
