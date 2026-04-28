"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RotateCcw } from "lucide-react";
import { resendFailedAction } from "@/app/(features)/campaigns/actions";

/**
 * F3 Part B · 캠페인 실패 건 재발송 버튼.
 *
 * 클릭 → 확인 다이얼로그 → resendFailedAction 호출.
 * 결과 분기:
 *   - success      → 성공 박스 + router.refresh()
 *   - blocked      → 빨간 박스 (야간 차단 등 이유)
 *   - failed       → 빨간 박스 (사유)
 *   - dev_seed_mode → 회색 안내 박스
 *
 * 실패 건이 0 인 경우엔 호출 자체를 막지 않음(서버에서 0건이면 그에 맞는 응답).
 * 단 disabled 처리해 사용자 혼동을 줄인다.
 */
interface Props {
  campaignId: string;
  failedCount: number;
}

type ResultMsg = {
  tone: "success" | "danger" | "muted";
  text: string;
};

export function ResendFailedButton({ campaignId, failedCount }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ResultMsg | null>(null);

  const onConfirm = () => {
    setResult(null);
    startTransition(async () => {
      const r = await resendFailedAction(campaignId);
      switch (r.status) {
        case "success":
          setResult({
            tone: "success",
            text: `재발송 완료. (성공 ${r.sent}건 / 실패 ${r.failed}건)`,
          });
          setConfirming(false);
          router.refresh();
          break;
        case "scheduled":
          setResult({
            tone: "success",
            text: "재발송이 예약되었습니다.",
          });
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

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={() => {
          setResult(null);
          setConfirming(true);
        }}
        disabled={failedCount === 0}
        className="
          inline-flex items-center gap-1.5 h-10 px-4 rounded-lg
          border border-[color:var(--border)] bg-white
          text-[14px] text-[color:var(--text)]
          hover:bg-[color:var(--bg-hover)]
          disabled:opacity-40 disabled:cursor-not-allowed
          transition-colors
        "
      >
        <RotateCcw className="size-4" strokeWidth={1.75} aria-hidden />
        실패 건 재발송
        {failedCount > 0 && (
          <span className="ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-[color:var(--danger-bg)] text-[11px] text-[color:var(--danger)] tabular-nums">
            {failedCount}
          </span>
        )}
      </button>

      {result && (
        <div
          role={result.tone === "danger" ? "alert" : "status"}
          className={
            result.tone === "success"
              ? "text-[13px] text-[color:var(--success)] max-w-md text-right"
              : result.tone === "danger"
                ? "text-[13px] text-[color:var(--danger)] max-w-md text-right"
                : "text-[13px] text-[color:var(--text-muted)] max-w-md text-right"
          }
        >
          {result.text}
        </div>
      )}

      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="resend-confirm-title"
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
          <div className="w-full max-w-md rounded-xl bg-white border border-[color:var(--border)] shadow-lg p-6 space-y-4">
            <h3
              id="resend-confirm-title"
              className="text-[18px] font-semibold text-[color:var(--text)]"
            >
              실패 건을 재발송할까요?
            </h3>
            <p className="text-[14px] text-[color:var(--text-muted)] leading-relaxed">
              실패 상태의 메시지{" "}
              <span className="tabular-nums font-medium text-[color:var(--text)]">
                {failedCount.toLocaleString("ko-KR")}건
              </span>
              을 다시 발송합니다. 솔라피 비용이 추가로 청구됩니다.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={isPending}
                className="
                  inline-flex items-center h-10 px-4 rounded-lg
                  border border-[color:var(--border)] bg-white
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
                  inline-flex items-center h-10 px-5 rounded-lg
                  bg-[color:var(--action)] text-[color:var(--action-text)]
                  text-[14px] font-medium
                  hover:bg-[color:var(--action-hover)]
                  disabled:opacity-50
                  transition-colors
                "
              >
                {isPending ? "재발송 중..." : "재발송"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
