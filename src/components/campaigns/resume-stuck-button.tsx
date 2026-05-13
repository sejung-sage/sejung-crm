"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Play } from "lucide-react";
import { resumeStuckCampaignAction } from "@/app/(features)/campaigns/actions";

/**
 * F3 Part B · 멈춘 캠페인 이어보내기 버튼.
 *
 * 캠페인 상태가 '발송중' 이지만 일정 시간 진행이 멈춘 경우(자가호출 chain
 * 단절) 사용자가 클릭해 다음 청크부터 발송을 재개한다.
 *
 * 결과 처리:
 *   - kicked              → 성공 박스 + router.refresh()
 *   - nothing_to_resume   → 회색 안내 (이미 끝났거나 대기 0건)
 *   - failed              → 빨간 박스 (권한·서버 오류)
 *   - dev_seed_mode       → 회색 안내
 *
 * 표시 조건은 호출자에서 결정(예: isInFlight && pendingCount > 0). 본 컴포넌트
 * 자체는 pendingCount 가 0 이면 disabled 처리해 추가 안전망을 둔다.
 */
interface Props {
  campaignId: string;
  pendingCount: number;
}

type ResultMsg = {
  tone: "success" | "danger" | "muted";
  text: string;
};

export function ResumeStuckButton({ campaignId, pendingCount }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ResultMsg | null>(null);

  const onClick = () => {
    setResult(null);
    startTransition(async () => {
      const r = await resumeStuckCampaignAction(campaignId);
      switch (r.status) {
        case "kicked":
          setResult({
            tone: "success",
            text: `발송을 재개했습니다. (대기 ${r.pendingCount.toLocaleString("ko-KR")}건)`,
          });
          router.refresh();
          break;
        case "nothing_to_resume":
          setResult({ tone: "muted", text: r.reason });
          router.refresh();
          break;
        case "failed":
          setResult({ tone: "danger", text: r.reason });
          break;
        case "dev_seed_mode":
          setResult({ tone: "muted", text: r.reason });
          break;
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pendingCount === 0 || isPending}
        className="
          inline-flex items-center gap-1.5 h-10 px-4 rounded-lg
          border border-[color:var(--border)] bg-bg-card
          text-[14px] text-[color:var(--text)]
          hover:bg-[color:var(--bg-hover)]
          disabled:opacity-40 disabled:cursor-not-allowed
          transition-colors
        "
      >
        <Play className="size-4" strokeWidth={1.75} aria-hidden />
        {isPending ? "재개 중..." : "이어보내기"}
        {pendingCount > 0 && (
          <span className="ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-[color:var(--bg-muted)] text-[11px] text-[color:var(--text-muted)] tabular-nums">
            {pendingCount}
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
    </div>
  );
}
