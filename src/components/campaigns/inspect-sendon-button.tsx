"use client";

import { useState, useTransition } from "react";
import { Search, Loader2 } from "lucide-react";
import { inspectCampaignSendonAction } from "@/app/(features)/campaigns/actions";
import type { InspectCampaignResult } from "@/lib/messaging/inspect-campaign-sendon";

/**
 * sendon 실제 발송 결과 점검 버튼 (master 전용).
 *
 * 우리 DB 는 "발송됨" 으로 기록해도 sendon 이 처리 실패(잔액 부족 등)시킨 건이 있을 수
 * 있다(도달 확인 webhook 미구현). 이 버튼이 캠페인의 sendon 측 실제 성공/실패/대기를
 * 조회해 우리 DB 와 대조해 보여준다.
 */
export function InspectSendonButton({ campaignId }: { campaignId: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<InspectCampaignResult | null>(null);

  const run = () => {
    setResult(null);
    start(async () => {
      const r = await inspectCampaignSendonAction(campaignId);
      setResult(r);
    });
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="
          inline-flex items-center gap-1.5 h-9 px-3 rounded-lg
          bg-[color:var(--bg-muted)] text-[color:var(--text)]
          border border-[color:var(--border)]
          text-[13px] font-medium
          hover:bg-[color:var(--bg-hover)]
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-colors
        "
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Search className="size-4" strokeWidth={1.75} aria-hidden />
        )}
        sendon 실제 발송 확인
      </button>

      {result && <ResultPanel result={result} />}
    </div>
  );
}

function ResultPanel({ result }: { result: InspectCampaignResult }) {
  if (result.status !== "ok") {
    return (
      <p className="text-[12px] text-[color:var(--danger)] max-w-[18rem] text-right">
        {result.reason ?? "조회에 실패했습니다."}
      </p>
    );
  }

  const { db, sendon, groups, queryErrors } = result;
  const mismatch =
    db && sendon ? db.발송됨 - (sendon.succeeded + sendon.sending) : 0;

  return (
    <div className="rounded-lg border border-[color:var(--border)] bg-bg-card p-3 text-[12px] text-[color:var(--text)] max-w-[20rem] space-y-1.5">
      <p className="font-medium">sendon 실제 결과</p>
      {sendon && (
        <ul className="space-y-0.5 tabular-nums">
          <li className="text-[color:var(--success)]">
            성공 {sendon.succeeded.toLocaleString()}
          </li>
          {sendon.sending > 0 && <li>발송 중 {sendon.sending.toLocaleString()}</li>}
          {sendon.pending > 0 && (
            <li>예약/대기 {sendon.pending.toLocaleString()}</li>
          )}
          <li className="text-[color:var(--danger)]">
            실패 {sendon.failed.toLocaleString()}
          </li>
          {sendon.canceled > 0 && <li>취소 {sendon.canceled.toLocaleString()}</li>}
          {sendon.blocked > 0 && (
            <li>수신거부 {sendon.blocked.toLocaleString()}</li>
          )}
          <li className="text-[color:var(--text-muted)] pt-0.5">
            sendon 합계 {sendon.total.toLocaleString()}
          </li>
        </ul>
      )}
      {db && (
        <p className="text-[color:var(--text-muted)] pt-1 border-t border-[color:var(--border)]">
          우리 DB: 발송됨 {db.발송됨.toLocaleString()} · 대기{" "}
          {db.대기.toLocaleString()} · 실패 {db.실패.toLocaleString()}
        </p>
      )}
      {mismatch > 0 && (
        <p className="text-[color:var(--danger)] font-medium">
          ⚠ 우리는 발송됨인데 sendon 에서 안 간 건 약 {mismatch.toLocaleString()}건
        </p>
      )}
      {groups && groups.failedToQuery > 0 && (
        <p className="text-[color:var(--text-muted)]">
          조회 실패 그룹 {groups.failedToQuery}/{groups.total}
          {queryErrors?.[0] ? ` (${queryErrors[0]})` : ""}
        </p>
      )}
    </div>
  );
}
