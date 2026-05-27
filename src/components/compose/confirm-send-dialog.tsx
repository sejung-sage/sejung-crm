"use client";

import { AlertTriangle, Send, CalendarClock } from "lucide-react";
import type { DedupeCounts } from "@/types/messaging";

/**
 * 문자 발송 직전 확인 다이얼로그.
 *
 * 발송은 되돌릴 수 없는 액션 (수십~수백 명에게 동시 발송, 비용 발생).
 * 사용자가 우발적으로 발송 버튼을 눌렀을 때를 위해 명시적 한 번 더 확인.
 *
 * 표시 정보:
 *   - 수신자 수 (동일번호 1회 발송 적용 시 실제 발송 건수 병기)
 *   - 발송 시점 (즉시 / 예약 시각)
 *   - 메시지 본문 (앞 일부)
 *   - 예상 비용
 *   - 캠페인 제목
 *
 * 확정 버튼은 즉시 발송 시 "지금 발송", 예약 시 "예약 등록".
 */
interface Props {
  mode: "now" | "schedule";
  scheduleAt: string | null;
  recipientCount: number;
  /**
   * 동일번호 1회 발송 카운트. backend 가 내려주고 적용·합침이 있을 때만 병기.
   * null/미적용/collapsed=0 이면 기존처럼 수신자 인원만 표시.
   */
  dedupe?: DedupeCounts | null;
  cost: number;
  messageBody: string;
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
}

const BODY_PREVIEW_LENGTH = 120;

export function ConfirmSendDialog({
  mode,
  scheduleAt,
  recipientCount,
  dedupe,
  cost,
  messageBody,
  title,
  onCancel,
  onConfirm,
}: Props) {
  const bodyPreview =
    messageBody.length > BODY_PREVIEW_LENGTH
      ? `${messageBody.slice(0, BODY_PREVIEW_LENGTH)}…`
      : messageBody;

  const dedupeApplied =
    !!dedupe && dedupe.dedupeApplied && dedupe.collapsed > 0;

  const scheduleLabel =
    mode === "schedule" && scheduleAt
      ? formatScheduleDisplay(scheduleAt)
      : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-send-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div className="w-full max-w-lg rounded-xl bg-bg-card border border-[color:var(--border)] shadow-lg overflow-hidden">
        <div className="px-6 pt-6 pb-4 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle
              className="size-5 text-[color:var(--warning)]"
              strokeWidth={1.75}
              aria-hidden
            />
            <h2
              id="confirm-send-title"
              className="text-[18px] font-semibold text-[color:var(--text)]"
            >
              {mode === "now"
                ? "지금 발송하시겠어요?"
                : "예약 발송을 등록하시겠어요?"}
            </h2>
          </div>
          <p className="text-[13px] text-[color:var(--text-muted)] leading-relaxed">
            발송된 메시지는 취소할 수 없습니다. 수신자·내용·시점을 마지막으로
            확인해 주세요.
          </p>
        </div>

        <div className="px-6 py-4 bg-[color:var(--bg-muted)] border-y border-[color:var(--border)] space-y-3">
          <Row
            label={dedupeApplied ? "실제 발송" : "수신자"}
            value={
              dedupeApplied && dedupe ? (
                <span className="tabular-nums text-right">
                  <strong className="text-[color:var(--text)]">
                    {dedupe.actualMessages.toLocaleString("ko-KR")}건
                  </strong>
                  <span className="block text-[12px] text-[color:var(--text-muted)]">
                    대상 학생 {dedupe.targetStudents.toLocaleString("ko-KR")}명 ·
                    동일번호 {dedupe.collapsed.toLocaleString("ko-KR")}건 합침
                  </span>
                </span>
              ) : (
                <span className="tabular-nums">
                  <strong className="text-[color:var(--text)]">
                    {recipientCount.toLocaleString("ko-KR")}명
                  </strong>
                </span>
              )
            }
          />
          <Row
            label="발송 시점"
            value={
              mode === "now" ? (
                <span className="inline-flex items-center gap-1 text-[color:var(--text)] font-medium">
                  <Send className="size-3.5" strokeWidth={1.75} aria-hidden />
                  즉시
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[color:var(--text)] font-medium">
                  <CalendarClock
                    className="size-3.5"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  {scheduleLabel}
                </span>
              )
            }
          />
          <Row
            label="예상 비용"
            value={
              <span className="tabular-nums text-[color:var(--text)] font-medium">
                {cost.toLocaleString("ko-KR")}원
              </span>
            }
          />
          <Row label="캠페인 제목" value={title || "—"} />
        </div>

        <div className="px-6 py-4 space-y-2">
          <p className="text-[12px] font-medium text-[color:var(--text-muted)]">
            메시지 본문
          </p>
          <p className="text-[14px] text-[color:var(--text)] leading-relaxed whitespace-pre-wrap break-words bg-bg-card">
            {bodyPreview}
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[color:var(--border)]">
          <button
            type="button"
            onClick={onCancel}
            className="
              inline-flex items-center h-11 px-4 rounded-lg
              border border-[color:var(--border)] bg-bg-card
              text-[14px] text-[color:var(--text)]
              hover:bg-[color:var(--bg-hover)]
              transition-colors
            "
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="
              inline-flex items-center gap-1.5 h-11 px-5 rounded-lg
              bg-[color:var(--action)] text-[color:var(--action-text)]
              text-[14px] font-medium
              hover:bg-[color:var(--action-hover)]
              transition-colors
            "
          >
            <Send className="size-4" strokeWidth={1.75} aria-hidden />
            {mode === "now" ? "지금 발송" : "예약 등록"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-[14px]">
      <span className="text-[color:var(--text-muted)]">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

/**
 * datetime-local 문자열 → 한국어 표시.
 * compose-step-4-send 의 동일 헬퍼와 같은 시맨틱 — 중복 import 회피용 inline.
 */
function formatScheduleDisplay(scheduleAt: string): string {
  const d = new Date(scheduleAt);
  if (Number.isNaN(d.getTime())) return scheduleAt;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}`;
}
