"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { resendCampaignSameFiltersAction } from "@/app/(features)/campaigns/actions";
import { ACTION_BTN_DEFAULT } from "./action-button-styles";

/**
 * 같은 조건으로 다시 보내기 버튼 (0121).
 *
 * "실패 건 재발송" 은 실패 *메시지 행* 을 다시 보내므로, 큐 적재 전에 죽어
 * 메시지가 0건인 캠페인에는 쓸 수 없다. 이 버튼은 저장된 발송 조건으로 수신자를
 * 다시 조회해 **새 캠페인**을 만든다 — 기존 실패 이력은 그대로 남는다.
 *
 * 발송 성공 시 새 캠페인 상세로 이동한다(진행률·결과를 그 화면에서 봐야 하므로).
 */
interface Props {
  campaignId: string;
  /** 원본 캠페인의 총 수신자 — 확인 다이얼로그 안내용(재조회 시 달라질 수 있음). */
  totalRecipients: number;
}

type ResultMsg = {
  tone: "success" | "danger" | "muted";
  text: string;
};

export function ResendSameFiltersButton({
  campaignId,
  totalRecipients,
}: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ResultMsg | null>(null);

  const onConfirm = () => {
    setResult(null);
    startTransition(async () => {
      const r = await resendCampaignSameFiltersAction(campaignId);
      switch (r.status) {
        case "success":
          setConfirming(false);
          router.push(`/campaigns/${r.campaignId}`);
          break;
        case "scheduled":
          setResult({ tone: "success", text: "재발송이 예약되었습니다." });
          setConfirming(false);
          break;
        case "blocked":
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
    <div className="flex flex-col items-stretch gap-2">
      <button
        type="button"
        onClick={() => {
          setResult(null);
          setConfirming(true);
        }}
        className={ACTION_BTN_DEFAULT}
      >
        <Send className="size-4" strokeWidth={1.75} aria-hidden />
        같은 조건으로 다시 보내기
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
          aria-labelledby="resend-same-filters-title"
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
              id="resend-same-filters-title"
              className="text-[18px] font-semibold text-[color:var(--text)]"
            >
              같은 조건으로 다시 보낼까요?
            </h3>
            <p className="text-[14px] text-[color:var(--text-muted)] leading-relaxed">
              이 캠페인과 같은 조건·같은 본문으로{" "}
              <span className="font-medium text-[color:var(--text)]">
                새 발송
              </span>
              을 만듭니다. 처음 발송 때 대상은{" "}
              <span className="tabular-nums font-medium text-[color:var(--text)]">
                {totalRecipients.toLocaleString("ko-KR")}명
              </span>
              이었고, 지금 조건에 맞는 학생을 다시 조회하므로 인원이 달라질 수
              있습니다. 발송 비용이 청구됩니다.
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
                  inline-flex items-center h-10 px-5 rounded-lg
                  bg-[color:var(--action)] text-[color:var(--action-text)]
                  text-[14px] font-medium
                  hover:bg-[color:var(--action-hover)]
                  disabled:opacity-50
                  transition-colors
                "
              >
                {isPending ? "발송 중..." : "다시 보내기"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
