"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ListRestart, Loader2 } from "lucide-react";
import { resendSendonFailedAction } from "@/app/(features)/campaigns/actions";
import { ACTION_BTN_DEFAULT } from "./action-button-styles";

/**
 * 예약 캠페인 "실패 건만 재발송" 버튼 (master 전용).
 *
 * sendon 이 예약 접수를 일부만 받아들이고 나머지를 처리 실패(포인트 부족 등)시킨
 * 경우, 살아있는 정상 예약은 건드리지 않고 sendon FAILED 건만 같은 예약 시각으로
 * 재접수한다. "같은 시각으로 재발송"(전체 재접수)과 달리 정상 예약분을 취소하지
 * 않으므로 중복 발송 위험이 없다. 포인트 충전 후 사용한다.
 */
export function ResendSendonFailedButton({
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
      `sendon 이 실패로 처리한 건만 ${scheduledLabel ? `예약 시각(${scheduledLabel}) 그대로 ` : "같은 예약 시각으로 "}다시 접수합니다.\n\n정상 예약된 건은 건드리지 않습니다. 포인트를 충전한 뒤 진행하세요.`,
    );
    if (!ok) return;
    setMsg(null);
    start(async () => {
      const r = await resendSendonFailedAction(campaignId);
      if (r.status === "resent") {
        setMsg({
          tone: "ok",
          text: `실패 ${r.requeued.toLocaleString()}건 재접수했습니다. sendon 실제 발송 확인으로 결과를 점검하세요.`,
        });
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
          <ListRestart className="size-4" strokeWidth={1.75} aria-hidden />
        )}
        실패건만 재발송
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
