"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Send, AlertTriangle, CheckCircle2, Calendar, MapPin } from "lucide-react";
import type { SeminarListItem, GroupListItem } from "@/types/database";
import { formatKstDateTime } from "@/lib/datetime";
import { createSeminarBroadcastAction } from "@/app/(features)/seminars/actions";
import type { SeminarComposeState } from "./seminar-compose-wizard";

/**
 * F5 · 설명회 발송 Step 4 — 최종 요약 + 발송 트리거.
 *
 * - 선택 요약 (설명회 N개 · 그룹 · 본문 첫 줄).
 * - 확인 다이얼로그 → createSeminarBroadcastAction.
 * - 결과:
 *    success → 캠페인 페이지로 이동 (campaignId).
 *    dev_seed_mode → 회색 안내 박스.
 *    failed → 빨간 박스 + 사유.
 */
interface Props {
  state: SeminarComposeState;
  selectedSeminars: SeminarListItem[];
  selectedGroup: GroupListItem;
  branch: string;
  onBackToBody: () => void;
}

type SendUiResult =
  | {
      kind: "success";
      campaignId: string;
      invitationCount: number;
      sent: number;
      failed: number;
    }
  | { kind: "blocked"; reason: string }
  | { kind: "dev_seed_mode"; reason: string }
  | { kind: "failed"; reason: string };

export function SeminarComposeStep4Send({
  state,
  selectedSeminars,
  selectedGroup,
  branch,
  onBackToBody,
}: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<SendUiResult | null>(null);

  const handleSend = () => {
    setConfirmOpen(false);
    startTransition(async () => {
      // backend `createSeminarBroadcastAction` — group_id 만 전달.
      // 학생 펼침은 서버 내부 `loadAllGroupRecipients` 가 처리 (URL 414 회피).
      const res = await createSeminarBroadcastAction({
        seminar_ids: state.selectedSeminarIds,
        group_id: selectedGroup.id,
        body: state.body,
        subject: state.type === "LMS" ? state.subject : null,
        type: state.type,
        branch,
        // 광고 토글 — step3 에서 입력. 서버가 prefix/footer/야간 차단 가드 적용.
        is_ad: state.isAd,
      });

      switch (res.status) {
        case "success":
          setResult({
            kind: "success",
            campaignId: res.campaign_id,
            invitationCount: res.invitation_count,
            sent: res.sent,
            failed: res.failed,
          });
          break;
        case "blocked":
          setResult({
            kind: "blocked",
            reason: res.reason ?? "발송 가드에 의해 차단되었습니다",
          });
          break;
        case "dev_seed_mode":
          setResult({
            kind: "dev_seed_mode",
            reason: `개발 시드 모드입니다. 실제 발송과 invitation 생성은 일어나지 않았습니다 (예상 ${res.invitation_count.toLocaleString()}건).`,
          });
          break;
        case "failed":
          setResult({
            kind: "failed",
            reason: res.reason ?? "발송에 실패했습니다",
          });
          break;
      }
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
          발송 확인
        </h2>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          아래 내용으로 학생별 신청 페이지가 발급되고 안내 문자가 발송됩니다.
        </p>
      </div>

      {/* 요약 카드 */}
      <section
        aria-label="발송 요약"
        className="rounded-xl border border-[color:var(--border-strong)] bg-bg-card divide-y divide-[color:var(--border)]"
      >
        <SummaryRow label="설명회">
          <ul className="space-y-1.5">
            {selectedSeminars.map((s) => (
              <li key={s.id} className="text-[14px] text-[color:var(--text)]">
                <div className="font-medium">{s.name}</div>
                <div className="mt-0.5 flex items-center flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-[color:var(--text-muted)] tabular-nums">
                  {s.held_at && (
                    <span className="inline-flex items-center gap-1">
                      <Calendar
                        className="size-3 text-[color:var(--text-dim)]"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                      {formatKstDateTime(s.held_at)}
                    </span>
                  )}
                  {s.venue && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin
                        className="size-3 text-[color:var(--text-dim)]"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                      {s.venue}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </SummaryRow>
        <SummaryRow label="대상">
          <div className="text-[14px] text-[color:var(--text)]">
            <span className="font-medium">{selectedGroup.name}</span>
            <span className="ml-2 text-[12px] text-[color:var(--text-muted)] tabular-nums">
              · 약 {selectedGroup.recipient_count.toLocaleString()}명
            </span>
          </div>
        </SummaryRow>
        <SummaryRow label="유형">
          <span className="text-[14px] text-[color:var(--text)] font-medium">
            {state.type}
          </span>
        </SummaryRow>
        {state.type === "LMS" && state.subject && (
          <SummaryRow label="제목">
            <span className="text-[14px] text-[color:var(--text)]">
              {state.subject}
            </span>
          </SummaryRow>
        )}
        <SummaryRow label="본문">
          <pre className="text-[13px] font-mono text-[color:var(--text)] whitespace-pre-wrap leading-relaxed">
            {state.body}
          </pre>
        </SummaryRow>
      </section>

      {/* 결과 박스 */}
      {result?.kind === "success" && (
        <div
          role="status"
          className="rounded-xl border border-[color:var(--success)] bg-[color:var(--success-bg)] p-5 space-y-3"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2
              className="size-5 text-[color:var(--success)]"
              strokeWidth={1.75}
              aria-hidden
            />
            <h3 className="text-[15px] font-semibold text-[color:var(--text)]">
              발송이 완료되었습니다
            </h3>
          </div>
          <p className="text-[13px] text-[color:var(--text-muted)] tabular-nums">
            초대 {result.invitationCount.toLocaleString()}건 ·
            성공 {result.sent.toLocaleString()}건 ·
            실패 {result.failed.toLocaleString()}건
          </p>
          <Link
            href={`/campaigns/${result.campaignId}`}
            className="
              inline-flex items-center gap-1.5 h-10 px-4 rounded-lg
              bg-[color:var(--action)] text-[color:var(--action-text)]
              text-[14px] font-medium
              hover:bg-[color:var(--action-hover)]
              transition-colors
            "
          >
            발송 내역 보기
          </Link>
        </div>
      )}
      {result?.kind === "blocked" && (
        <div
          role="alert"
          className="rounded-xl border border-[color:var(--warning)] bg-[color:var(--warning-bg)] p-5 space-y-3"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle
              className="size-5 text-[color:var(--warning)]"
              strokeWidth={1.75}
              aria-hidden
            />
            <h3 className="text-[15px] font-semibold text-[color:var(--text)]">
              발송이 차단되었습니다
            </h3>
          </div>
          <p className="text-[13px] text-[color:var(--text)]">{result.reason}</p>
          <button
            type="button"
            onClick={() => {
              setResult(null);
              onBackToBody();
            }}
            className="
              inline-flex items-center h-10 px-4 rounded-lg
              border border-[color:var(--border-strong)] bg-bg-card
              text-[14px] text-[color:var(--text)]
              hover:bg-[color:var(--bg-hover)]
              transition-colors
            "
          >
            본문으로 돌아가기
          </button>
        </div>
      )}
      {result?.kind === "dev_seed_mode" && (
        <div
          role="note"
          className="rounded-xl border border-[color:var(--border-strong)] bg-[color:var(--bg-muted)] p-5"
        >
          <p className="text-[14px] text-[color:var(--text-muted)]">
            {result.reason}
          </p>
        </div>
      )}
      {result?.kind === "failed" && (
        <div
          role="alert"
          className="rounded-xl border border-[color:var(--danger)] bg-[color:var(--danger-bg)] p-5 space-y-3"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle
              className="size-5 text-[color:var(--danger)]"
              strokeWidth={1.75}
              aria-hidden
            />
            <h3 className="text-[15px] font-semibold text-[color:var(--text)]">
              발송에 실패했습니다
            </h3>
          </div>
          <p className="text-[13px] text-[color:var(--text)]">{result.reason}</p>
          <button
            type="button"
            onClick={() => {
              setResult(null);
              onBackToBody();
            }}
            className="
              inline-flex items-center h-10 px-4 rounded-lg
              border border-[color:var(--border-strong)] bg-bg-card
              text-[14px] text-[color:var(--text)]
              hover:bg-[color:var(--bg-hover)]
              transition-colors
            "
          >
            본문으로 돌아가기
          </button>
        </div>
      )}

      {/* 발송 버튼 */}
      {!result && (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={isPending}
            className="
              inline-flex items-center gap-1.5 h-10 px-5 rounded-lg
              bg-[color:var(--action)] text-[color:var(--action-text)]
              text-[14px] font-semibold
              hover:bg-[color:var(--action-hover)]
              disabled:opacity-60 disabled:cursor-not-allowed
              transition-colors
            "
          >
            <Send className="size-4" strokeWidth={1.75} aria-hidden />
            {isPending ? "발송 중..." : "지금 발송"}
          </button>
        </div>
      )}

      {/* 확인 다이얼로그 */}
      {confirmOpen && (
        <ConfirmDialog
          onCancel={() => setConfirmOpen(false)}
          onConfirm={handleSend}
          summary={{
            seminarCount: selectedSeminars.length,
            recipientCount: selectedGroup.recipient_count,
          }}
        />
      )}

    </div>
  );
}

function SummaryRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-4 px-4 py-3">
      <dt className="w-16 shrink-0 text-[12px] font-medium text-[color:var(--text-muted)] pt-0.5 uppercase tracking-wide">
        {label}
      </dt>
      <dd className="flex-1 min-w-0">{children}</dd>
    </div>
  );
}

// ─── 확인 다이얼로그 ──────────────────────────────────────

function ConfirmDialog({
  onCancel,
  onConfirm,
  summary,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  summary: { seminarCount: number; recipientCount: number };
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="seminar-broadcast-confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-bg-card border border-[color:var(--border-strong)] p-6 space-y-4">
        <h3
          id="seminar-broadcast-confirm-title"
          className="text-[17px] font-semibold text-[color:var(--text)]"
        >
          지금 발송할까요?
        </h3>
        <div className="rounded-lg bg-[color:var(--bg-muted)] p-3 text-[13px] text-[color:var(--text)] space-y-1">
          <div>
            설명회 <strong>{summary.seminarCount}</strong>개
          </div>
          <div className="tabular-nums">
            대상 학생 약 <strong>{summary.recipientCount.toLocaleString()}</strong>명
          </div>
        </div>
        <p className="text-[13px] text-[color:var(--text-muted)] leading-relaxed">
          발송 후에는 학생별 신청 페이지가 즉시 활성화됩니다. 학생별 초대 행은
          취소할 수 없으니 본문과 대상을 한 번 더 확인해 주세요.
        </p>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="
              inline-flex items-center h-10 px-4 rounded-lg
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
              inline-flex items-center h-10 px-5 rounded-lg
              bg-[color:var(--action)] text-[color:var(--action-text)]
              text-[14px] font-semibold
              hover:bg-[color:var(--action-hover)]
              transition-colors
            "
          >
            확인하고 발송
          </button>
        </div>
      </div>
    </div>
  );
}
