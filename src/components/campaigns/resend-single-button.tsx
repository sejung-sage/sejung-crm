"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RotateCcw, Loader2 } from "lucide-react";
import type { MessageStatus } from "@/types/database";
import { resendSingleMessageAction } from "@/app/(features)/campaigns/actions";

/**
 * F3 Part B · 캠페인 건별(학생 1명) 재발송 버튼.
 *
 * 일괄 재발송 버튼(resend-failed-button.tsx)의 확인·결과 톤을 행 단위로 미러.
 * 행마다 독립 동작하므로 pending/result 상태를 이 컴포넌트 인스턴스가 자체 보유.
 *
 * 클릭 → 확인 다이얼로그 → resendSingleMessageAction(messageId) 호출.
 * 결과 분기 (SendCampaignResult union):
 *   - success      → 성공 토스트 + router.refresh()
 *   - scheduled    → 성공 톤 안내
 *   - blocked      → 빨간 안내 (야간 차단 등)
 *   - failed       → 빨간 안내 (사유)
 *   - dev_seed_mode → 회색 안내
 *
 * 상태별 활성화:
 *   - 실패 / 발송됨 → 재발송 가능 (활성)
 *   - 대기(발송중) / 도달 → 비활성 (title·aria 로 사유 안내)
 *   서버 액션이 최종 방어하지만 UI 가 1차로 막아 오발송·혼동을 줄인다.
 */
interface Props {
  messageId: string;
  status: MessageStatus;
  /** 안내 문구·확인 메시지에 쓸 학생명. null 이면 "이 학생". */
  studentName: string | null;
}

type ResultMsg = {
  tone: "success" | "danger" | "muted";
  text: string;
};

// 재발송 가능 상태: 이미 발송 흐름을 끝낸 건만. (대기=발송중, 도달=확정 수신)
const RESENDABLE: ReadonlySet<MessageStatus> = new Set<MessageStatus>([
  "발송됨",
  "실패",
]);

function disabledReason(status: MessageStatus): string {
  switch (status) {
    case "대기":
      return "발송 대기 중인 메시지는 재발송할 수 없습니다.";
    case "도달":
      return "이미 도달한 메시지는 재발송할 수 없습니다.";
    default:
      return "재발송할 수 없는 상태입니다.";
  }
}

export function ResendSingleButton({ messageId, status, studentName }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ResultMsg | null>(null);

  const resendable = RESENDABLE.has(status);
  const name = studentName ?? "이 학생";

  const onConfirm = () => {
    setResult(null);
    startTransition(async () => {
      const r = await resendSingleMessageAction(messageId);
      switch (r.status) {
        case "success":
          setResult({ tone: "success", text: "재발송 완료" });
          setConfirming(false);
          router.refresh();
          break;
        case "scheduled":
          setResult({ tone: "success", text: "재발송이 예약되었습니다." });
          setConfirming(false);
          break;
        case "blocked":
          setResult({ tone: "danger", text: r.reason });
          setConfirming(false);
          break;
        case "failed":
          setResult({ tone: "danger", text: r.reason });
          setConfirming(false);
          break;
        case "dev_seed_mode":
          setResult({ tone: "muted", text: r.reason });
          setConfirming(false);
          break;
      }
    });
  };

  if (!resendable) {
    // 비활성 버튼 — 사유는 title·aria-label 로 안내.
    return (
      <button
        type="button"
        disabled
        title={disabledReason(status)}
        aria-label={`재발송 불가: ${disabledReason(status)}`}
        className="
          inline-flex items-center justify-center gap-1
          h-9 px-2.5 rounded-lg
          border border-[color:var(--border)] bg-bg-card
          text-[13px] text-[color:var(--text-muted)]
          opacity-40 cursor-not-allowed
        "
      >
        <RotateCcw className="size-4" strokeWidth={1.75} aria-hidden />
        <span className="hidden sm:inline">재발송</span>
      </button>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => {
          setResult(null);
          setConfirming(true);
        }}
        disabled={isPending}
        aria-label={`${name}에게 재발송`}
        className="
          inline-flex items-center justify-center gap-1
          h-9 px-2.5 rounded-lg
          border border-[color:var(--border)] bg-bg-card
          text-[13px] text-[color:var(--text)]
          hover:bg-[color:var(--bg-hover)]
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-colors
        "
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden />
        ) : (
          <RotateCcw className="size-4" strokeWidth={1.75} aria-hidden />
        )}
        <span className="hidden sm:inline">
          {isPending ? "재발송 중" : "재발송"}
        </span>
      </button>

      {result && (
        <div
          role={result.tone === "danger" ? "alert" : "status"}
          className={
            result.tone === "success"
              ? "text-[12px] text-[color:var(--success)] max-w-[14rem]"
              : result.tone === "danger"
                ? "text-[12px] text-[color:var(--danger)] max-w-[14rem]"
                : "text-[12px] text-[color:var(--text-muted)] max-w-[14rem]"
          }
        >
          {result.text}
        </div>
      )}

      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`resend-single-title-${messageId}`}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isPending) {
              setConfirming(false);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !isPending) setConfirming(false);
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-bg-card border border-[color:var(--border)] shadow-lg p-6 space-y-4">
            <h3
              id={`resend-single-title-${messageId}`}
              className="text-[18px] font-semibold text-[color:var(--text)]"
            >
              다시 보낼까요?
            </h3>
            <p className="text-[14px] text-[color:var(--text-muted)] leading-relaxed">
              <span className="font-medium text-[color:var(--text)]">{name}</span>
              에게 다시 보낼까요? 발송 비용이 추가됩니다.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={isPending}
                className="
                  inline-flex items-center h-10 px-4 rounded-lg
                  border border-[color:var(--border)] bg-bg-card
                  text-[14px] text-[color:var(--text)]
                  hover:bg-[color:var(--bg-hover)]
                  disabled:opacity-50 transition-colors
                "
              >
                취소
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={isPending}
                className="
                  inline-flex items-center gap-1.5 h-10 px-5 rounded-lg
                  bg-[color:var(--action)] text-[color:var(--action-text)]
                  text-[14px] font-medium
                  hover:bg-[color:var(--action-hover)]
                  disabled:opacity-50
                  transition-colors
                "
              >
                {isPending && (
                  <Loader2
                    className="size-4 animate-spin"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                )}
                {isPending ? "재발송 중..." : "재발송"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
