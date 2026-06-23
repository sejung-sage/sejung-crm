"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Send, AlertTriangle, CheckCircle2, X, Loader2 } from "lucide-react";
import { excelSendAction } from "@/app/(features)/excel-send/actions";
import { countEucKrBytes } from "@/lib/messaging/sms-bytes";
import { BYTE_LIMITS } from "@/lib/schemas/template";

interface Recipient {
  name: string;
  phone: string;
}

interface Props {
  /** 발송 대상 (선택된 학생). name + 학부모 연락처. */
  recipients: Recipient[];
  /** 헤더 맥락 (예: "5회차 · 6월 13일" / "전체 수강생"). */
  contextLabel: string;
  onClose: () => void;
}

type Result =
  | { kind: "success"; campaignId: string; sent: number }
  | { kind: "blocked"; reason: string }
  | { kind: "failed"; reason: string }
  | { kind: "dev_seed"; reason: string };

/**
 * 강좌/회차 명단에서 선택한 학생에게 같은 화면 팝업으로 바로 문자 발송.
 *
 * 그룹 생성·페이지 이동 없이 ad-hoc 발송(excelSendAction) 재사용 — group_id=null
 * 캠페인 + 드레인 워커가 백그라운드 발송, 진행률은 캠페인 상세에서 확인.
 * 발송 안전 가드(광고 prefix/080 footer/야간 차단/수신거부 제외)는 서버에서 적용.
 */
export function ClassSendModal({ recipients, contextLabel, onClose }: Props) {
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [isAd, setIsAd] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [isPending, startTransition] = useTransition();

  const bytes = countEucKrBytes(body);
  // SMS 한도 초과면 자동 LMS. 광고 가드(prefix/footer)로 실제 바이트는 더 늘 수 있어
  // 서버가 발송 직전 한도를 한 번 더 검증한다.
  const type: "SMS" | "LMS" = bytes <= BYTE_LIMITS.SMS ? "SMS" : "LMS";

  const handleSend = () => {
    if (body.trim().length === 0) return;
    setResult(null);
    startTransition(async () => {
      const res = await excelSendAction({
        recipients,
        type,
        subject: type === "LMS" && subject.trim() ? subject.trim() : null,
        body: body.trim(),
        isAd,
      });
      switch (res.status) {
        case "success":
          setResult({
            kind: "success",
            campaignId: res.campaignId,
            sent: res.sent,
          });
          break;
        case "scheduled":
          // ad-hoc 발송은 예약을 쓰지 않지만 타입 호환 위해 방어.
          setResult({ kind: "success", campaignId: res.campaignId, sent: 0 });
          break;
        case "blocked":
          setResult({ kind: "blocked", reason: res.reason });
          break;
        case "dev_seed_mode":
          setResult({ kind: "dev_seed", reason: res.reason });
          break;
        case "failed":
          setResult({ kind: "failed", reason: res.reason });
          break;
      }
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="class-send-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isPending) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !isPending) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl bg-bg-card border border-[color:var(--border-strong)] shadow-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        {/* 헤더 */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="class-send-title"
              className="text-[18px] font-semibold text-[color:var(--text)]"
            >
              문자 발송
            </h2>
            <p className="mt-0.5 text-[13px] text-[color:var(--text-muted)]">
              {contextLabel} ·{" "}
              <strong className="text-[color:var(--text)] tabular-nums">
                {recipients.length.toLocaleString()}명
              </strong>
              에게 발송
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            aria-label="닫기"
            className="inline-flex items-center justify-center size-8 rounded-md text-[color:var(--text-muted)] hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text)] transition-colors disabled:opacity-50"
          >
            <X className="size-5" strokeWidth={1.75} aria-hidden />
          </button>
        </div>

        {result?.kind === "success" ? (
          <SuccessBox
            campaignId={result.campaignId}
            recipientCount={recipients.length}
            onClose={onClose}
          />
        ) : (
          <>
            {/* LMS 제목 (장문일 때만) */}
            {type === "LMS" && (
              <label className="block space-y-1.5">
                <span className="text-[14px] font-medium text-[color:var(--text)]">
                  제목{" "}
                  <span className="text-[12px] font-normal text-[color:var(--text-dim)]">
                    (선택)
                  </span>
                </span>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="장문(LMS) 제목 — 비우면 본문 앞부분 사용"
                  maxLength={120}
                  className="w-full h-11 rounded-lg px-3 bg-bg-card border border-[color:var(--border)] text-[15px] text-[color:var(--text)] focus:outline-none focus:border-[color:var(--border-strong)]"
                />
              </label>
            )}

            {/* 본문 */}
            <label className="block space-y-1.5">
              <span className="text-[14px] font-medium text-[color:var(--text)]">
                본문
              </span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={6}
                placeholder="보낼 내용을 입력하세요"
                className="w-full rounded-lg px-3 py-2.5 bg-bg-card border border-[color:var(--border)] text-[15px] leading-relaxed text-[color:var(--text)] placeholder:text-[color:var(--text-dim)] focus:outline-none focus:border-[color:var(--border-strong)] resize-y"
              />
              <span className="text-[12px] text-[color:var(--text-muted)] tabular-nums">
                {type} · {bytes}바이트
              </span>
            </label>

            {/* 광고 토글 */}
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isAd}
                onChange={(e) => setIsAd(e.target.checked)}
                className="mt-0.5 size-4 cursor-pointer accent-[color:var(--action)]"
              />
              <span className="text-[13px] text-[color:var(--text-muted)] leading-relaxed">
                광고성 문자로 발송 — (광고) 표기·무료수신거부 안내가 자동
                삽입됩니다.
              </span>
            </label>

            {/* 결과(차단/실패/시드) */}
            {result?.kind === "blocked" && (
              <ResultNote tone="warning" reason={result.reason} />
            )}
            {result?.kind === "failed" && (
              <ResultNote tone="danger" reason={result.reason} />
            )}
            {result?.kind === "dev_seed" && (
              <ResultNote tone="muted" reason={result.reason} />
            )}

            {/* 액션 */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[color:var(--border)]">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="inline-flex items-center h-11 px-4 rounded-lg border border-[color:var(--border)] bg-bg-card text-[14px] text-[color:var(--text)] hover:bg-[color:var(--bg-hover)] disabled:opacity-50 transition-colors"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={isPending || body.trim().length === 0}
                className="inline-flex items-center justify-center gap-1.5 h-11 px-5 rounded-lg bg-[color:var(--action)] text-[color:var(--action-text)] text-[14px] font-medium hover:bg-[color:var(--action-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isPending ? (
                  <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
                ) : (
                  <Send className="size-4" strokeWidth={1.75} aria-hidden />
                )}
                {isPending ? "발송 중..." : `${recipients.length}명에게 발송`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SuccessBox({
  campaignId,
  recipientCount,
  onClose,
}: {
  campaignId: string;
  recipientCount: number;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[color:var(--success)] bg-[color:var(--success-bg)] p-4 space-y-2">
        <div className="flex items-center gap-2">
          <CheckCircle2
            className="size-5 text-[color:var(--success)]"
            strokeWidth={1.75}
            aria-hidden
          />
          <h3 className="text-[15px] font-semibold text-[color:var(--text)]">
            발송을 시작했습니다
          </h3>
        </div>
        <p className="text-[13px] text-[color:var(--text-muted)] tabular-nums">
          {recipientCount.toLocaleString()}명에게 발송이 시작되었습니다. 실제
          발송은 백그라운드에서 진행되며 진행 상황은 발송 내역에서 확인할 수
          있습니다.
        </p>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center h-11 px-4 rounded-lg border border-[color:var(--border)] bg-bg-card text-[14px] text-[color:var(--text)] hover:bg-[color:var(--bg-hover)] transition-colors"
        >
          닫기
        </button>
        <Link
          href={`/campaigns/${campaignId}`}
          className="inline-flex items-center gap-1.5 h-11 px-4 rounded-lg bg-[color:var(--action)] text-[color:var(--action-text)] text-[14px] font-medium hover:bg-[color:var(--action-hover)] transition-colors"
        >
          발송 진행 상황 보기
        </Link>
      </div>
    </div>
  );
}

function ResultNote({
  tone,
  reason,
}: {
  tone: "warning" | "danger" | "muted";
  reason: string;
}) {
  const cls =
    tone === "danger"
      ? "border-[color:var(--danger)] bg-[color:var(--danger-bg)] text-[color:var(--danger)]"
      : tone === "warning"
        ? "border-[color:var(--warning)] bg-[color:var(--warning-bg)] text-[color:var(--text)]"
        : "border-[color:var(--border)] bg-[color:var(--bg-muted)] text-[color:var(--text-muted)]";
  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[13px] ${cls}`}
    >
      {tone !== "muted" && (
        <AlertTriangle
          className="size-4 shrink-0 mt-0.5"
          strokeWidth={1.75}
          aria-hidden
        />
      )}
      <span className="leading-relaxed">{reason}</span>
    </div>
  );
}
