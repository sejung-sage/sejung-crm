"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RefreshCw, Loader2 } from "lucide-react";
import { resendScheduledCampaignAction } from "@/app/(features)/campaigns/actions";
import { ACTION_BTN_DEFAULT } from "./action-button-styles";

/**
 * 예약 캠페인 "같은 시각으로 재발송" 버튼 (master 전용).
 *
 * sendon 이 예약 접수를 처리 실패시켰는데 우리 DB 는 '예약됨' 으로 남은 캠페인을,
 * 포인트 충전 후 같은 예약 시각으로 sendon 에 다시 접수시킨다.
 * sendon 콘솔에서 "처리 실패" 를 확인했다는 전제이므로 confirm 으로 경고한다.
 */
export function ResendScheduledButton({
  campaignId,
  scheduledLabel,
}: {
  campaignId: string;
  /** 안내 문구용 예약 시각 라벨(KST). */
  scheduledLabel?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(
    null,
  );

  const run = () => {
    const ok = window.confirm(
      `이 캠페인을 ${scheduledLabel ? `예약 시각(${scheduledLabel}) 그대로 ` : "같은 예약 시각으로 "}sendon 에 다시 접수합니다.\n\nsendon 콘솔에서 "처리 실패" 를 확인했고 포인트를 충전한 경우에만 진행하세요. 실제로 발송이 살아있다면 이중 발송될 수 있습니다.`,
    );
    if (!ok) return;
    setMsg(null);
    start(async () => {
      const r = await resendScheduledCampaignAction(campaignId);
      if (r.status === "resent") {
        setMsg({ tone: "ok", text: "재접수했습니다. sendon 실제 발송 확인으로 결과를 점검하세요." });
        router.refresh();
      } else {
        setMsg({ tone: "err", text: r.reason ?? "재발송에 실패했습니다." });
      }
    });
  };

  return (
    <div className="flex flex-col items-stretch gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className={ACTION_BTN_DEFAULT}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="size-4" strokeWidth={1.75} aria-hidden />
        )}
        같은 시각으로 재발송
      </button>
      {msg && (
        <p
          className={`self-end w-[13rem] text-[12px] text-right ${
            msg.tone === "ok"
              ? "text-[color:var(--success)]"
              : "text-[color:var(--danger)]"
          }`}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
