"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarX } from "lucide-react";
import { cancelScheduledCampaignAction } from "@/app/(features)/campaigns/actions";
import { ACTION_BTN_DANGER } from "./action-button-styles";

/**
 * 예약 발송 취소 버튼 — status='예약됨' 캠페인에서만 노출.
 *
 * 클릭 → 확인 다이얼로그 → cancelScheduledCampaignAction.
 *   - cancelled       → router.refresh() (상태가 '취소'로 갱신)
 *   - failed          → 빨간 안내(이미 발송 시작 등)
 *   - dev_seed_mode   → 회색 안내
 */
interface Props {
  campaignId: string;
}

type ResultMsg = { tone: "danger" | "muted"; text: string };

export function CancelScheduledButton({ campaignId }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ResultMsg | null>(null);

  const onConfirm = () => {
    setResult(null);
    startTransition(async () => {
      const r = await cancelScheduledCampaignAction(campaignId);
      if (r.status === "cancelled") {
        setConfirming(false);
        router.refresh();
      } else if (r.status === "dev_seed_mode") {
        setResult({ tone: "muted", text: r.reason });
        setConfirming(false);
      } else {
        setResult({ tone: "danger", text: r.reason });
        setConfirming(false);
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
        className={ACTION_BTN_DANGER}
      >
        <CalendarX className="size-4" strokeWidth={1.75} aria-hidden />
        예약 취소
      </button>

      {result && (
        <div
          role={result.tone === "danger" ? "alert" : "status"}
          className={`text-[13px] max-w-md text-right ${
            result.tone === "danger"
              ? "text-[color:var(--danger)]"
              : "text-[color:var(--text-muted)]"
          }`}
        >
          {result.text}
        </div>
      )}

      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-scheduled-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isPending) setConfirming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !isPending) setConfirming(false);
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-bg-card border border-[color:var(--border)] shadow-lg p-6 space-y-4">
            <h3
              id="cancel-scheduled-title"
              className="text-[18px] font-semibold text-[color:var(--text)]"
            >
              예약을 취소할까요?
            </h3>
            <p className="text-[14px] text-[color:var(--text-muted)] leading-relaxed">
              예약된 발송이 취소되어 자동 발송되지 않습니다. 이미 발송이 시작된
              뒤에는 취소할 수 없습니다.
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
                돌아가기
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={isPending}
                className="
                  inline-flex items-center h-10 px-5 rounded-lg
                  bg-[color:var(--danger)] text-white
                  text-[14px] font-medium
                  hover:opacity-90 disabled:opacity-50
                  transition-colors
                "
              >
                {isPending ? "취소 중..." : "예약 취소"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
