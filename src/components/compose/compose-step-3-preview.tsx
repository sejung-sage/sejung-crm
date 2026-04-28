"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, Moon, Send, Users } from "lucide-react";
import type { GroupListItem } from "@/types/database";
import type { PreviewResult } from "@/lib/messaging/preview-recipients";
import {
  previewAction,
  testSendAction,
} from "@/app/(features)/compose/actions";
import { maskPhone } from "@/lib/phone";
import type { ComposeStep2State } from "./compose-wizard";

/**
 * F3 Part B · Step 3 — 미리보기 · 비용 · 테스트 발송 + 캠페인 제목.
 *
 * - 마운트 시 또는 입력 변경 시 previewAction 호출.
 * - 야간 광고 차단(`blockedByQuietHours`) 이면 빨간 박스 + 다음 비활성.
 * - 우상단 "테스트 발송" → 다이얼로그(본인 번호 입력 → testSendAction).
 * - 캠페인 제목 입력은 이 단계 마지막 필드.
 */
interface Props {
  groupId: string;
  selectedGroup: GroupListItem;
  step2: ComposeStep2State;
  preview: PreviewResult | null;
  onPreview: (p: PreviewResult | null) => void;
  title: string;
  onTitleChange: (t: string) => void;
}

export function ComposeStep3Preview({
  groupId,
  selectedGroup,
  step2,
  preview,
  onPreview,
  title,
  onTitleChange,
}: Props) {
  const [loading, startLoading] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [testOpen, setTestOpen] = useState(false);

  // 마운트 / step2·groupId 변경 시 미리보기 재호출
  useEffect(() => {
    setErrorMsg(null);
    onPreview(null);
    startLoading(async () => {
      const result = await previewAction({
        groupId,
        step2: {
          templateId: step2.templateId,
          type: step2.type,
          subject: step2.subject,
          body: step2.body,
          isAd: step2.isAd,
        },
      });
      if (result.status === "success") {
        onPreview(result.data);
      } else {
        setErrorMsg(result.reason);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    groupId,
    step2.body,
    step2.isAd,
    step2.subject,
    step2.type,
    step2.templateId,
  ]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
            발송 미리보기
          </h2>
          <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
            가드 적용 후 실제 발송될 본문과 수신자를 확인하세요.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setTestOpen(true)}
          disabled={!preview || preview.recipientCount === 0 || loading}
          className="
            inline-flex items-center gap-1.5 h-10 px-4 rounded-lg
            border border-[color:var(--border)] bg-white
            text-[14px] text-[color:var(--text)]
            hover:bg-[color:var(--bg-hover)]
            disabled:opacity-40 disabled:cursor-not-allowed
            transition-colors
          "
        >
          <Send className="size-4" strokeWidth={1.75} aria-hidden />
          테스트 발송
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-[14px] text-[color:var(--text-muted)]">
          <Loader2
            className="size-4 animate-spin"
            strokeWidth={1.75}
            aria-hidden
          />
          미리보기를 계산하는 중...
        </div>
      )}

      {errorMsg && !loading && (
        <div
          role="alert"
          className="rounded-lg border border-[color:var(--danger)] bg-[color:var(--danger-bg)] px-4 py-3 text-[14px] text-[color:var(--danger)]"
        >
          {errorMsg}
        </div>
      )}

      {preview && !loading && (
        <>
          {preview.blockedByQuietHours && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-[color:var(--danger)] bg-[color:var(--danger-bg)] px-4 py-3"
            >
              <Moon
                className="size-4 mt-0.5 text-[color:var(--danger)]"
                strokeWidth={1.75}
                aria-hidden
              />
              <div className="text-[13px] leading-relaxed text-[color:var(--text)]">
                <strong className="font-medium text-[color:var(--danger)]">
                  야간 광고 차단:
                </strong>{" "}
                {preview.blockReason ??
                  "21시 ~ 08시 사이에는 광고성 문자를 발송할 수 없습니다."}{" "}
                예약 발송으로 시간을 다음 날 아침 이후로 잡아주세요.
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 좌: 수신자 카드 */}
            <section
              aria-label="수신자"
              className="rounded-lg border border-[color:var(--border)] p-4 space-y-3"
            >
              <div className="flex items-center gap-2">
                <Users
                  className="size-4 text-[color:var(--text-muted)]"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span className="text-[14px] font-medium text-[color:var(--text)]">
                  발송 대상
                </span>
              </div>
              <div className="text-[26px] font-semibold tabular-nums text-[color:var(--text)]">
                {preview.recipientCount.toLocaleString()}
                <span className="ml-1 text-[14px] font-normal text-[color:var(--text-muted)]">
                  명
                </span>
              </div>

              {preview.excludedCount > 0 && (
                <div className="text-[13px] text-[color:var(--text-muted)] space-y-0.5">
                  <div>
                    제외{" "}
                    <span className="tabular-nums text-[color:var(--text)]">
                      {preview.excludedCount.toLocaleString()}
                    </span>
                    명
                  </div>
                  <ul className="ml-3 list-disc space-y-0.5 text-[12px]">
                    {preview.excludedReasons.map((r) => (
                      <li key={r.reason}>
                        {r.reason}{" "}
                        <span className="tabular-nums">
                          {r.count.toLocaleString()}
                        </span>
                        명
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {preview.recipientCount === 0 && (
                <div
                  role="alert"
                  className="rounded-md border border-[color:var(--warning)] bg-[color:var(--warning-bg)] px-3 py-2 text-[13px] text-[color:var(--text)]"
                >
                  발송 가능한 수신자가 없습니다. 그룹 조건을 다시 확인해 주세요.
                </div>
              )}

              {preview.sampleRecipients.length > 0 && (
                <div className="pt-2 border-t border-[color:var(--border)]">
                  <p className="text-[12px] text-[color:var(--text-muted)] mb-1.5">
                    수신자 샘플 (최대 5명)
                  </p>
                  <ul className="space-y-1 text-[13px] text-[color:var(--text)]">
                    {preview.sampleRecipients.map((s, i) => (
                      <li
                        key={`${s.phone}-${i}`}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="truncate">{s.name}</span>
                        <span className="tabular-nums text-[color:var(--text-muted)]">
                          {maskPhone(s.phone)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {/* 우: 최종 본문 */}
            <section
              aria-label="최종 본문"
              className="rounded-lg border border-[color:var(--border)] p-4 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[14px] font-medium text-[color:var(--text)]">
                  최종 발송 본문
                </span>
                <span className="text-[12px] text-[color:var(--text-muted)] tabular-nums">
                  {step2.type === "ALIMTALK" ? "알림톡" : step2.type}
                </span>
              </div>
              {step2.subject && (
                <div className="text-[13px] text-[color:var(--text-muted)]">
                  <span className="font-medium text-[color:var(--text)]">
                    제목{" "}
                  </span>
                  {step2.subject}
                </div>
              )}
              <pre
                className="
                  whitespace-pre-wrap break-words
                  text-[14px] leading-relaxed text-[color:var(--text)]
                  p-3 rounded-md bg-[color:var(--bg-muted)]
                  min-h-32
                "
                style={{ fontFamily: "var(--font-sans)" }}
              >
                {preview.finalBody}
              </pre>
              <p className="text-[12px] text-[color:var(--text-dim)]">
                [광고] 머리말과 080 수신거부 안내는 광고 체크 시 자동
                삽입됩니다.
              </p>
            </section>
          </div>

          {/* 비용 카드 */}
          <section
            aria-label="예상 비용"
            className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] p-4 flex items-center justify-between gap-4 flex-wrap"
          >
            <div className="text-[14px] text-[color:var(--text-muted)]">
              예상 비용
            </div>
            <div className="text-[14px] tabular-nums text-[color:var(--text)]">
              {preview.cost.recipientCount.toLocaleString("ko-KR")}건 ×{" "}
              {preview.cost.unitCost.toLocaleString("ko-KR")}원 ={" "}
              <span className="text-[18px] font-semibold ml-1">
                {preview.cost.totalCost.toLocaleString("ko-KR")}원
              </span>
            </div>
          </section>

          {/* 캠페인 제목 */}
          <div className="space-y-1.5 pt-2">
            <label
              htmlFor="compose-title"
              className="text-[14px] font-medium text-[color:var(--text)]"
            >
              캠페인 제목
              <span className="ml-2 text-[12px] text-[color:var(--text-dim)]">
                내부 관리용. 수신자에게 노출되지 않습니다.
              </span>
            </label>
            <input
              id="compose-title"
              type="text"
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder={`예: ${selectedGroup.name} 4월 정기 안내`}
              maxLength={60}
              className="
                w-full h-10 rounded-lg px-3
                bg-white border border-[color:var(--border)]
                text-[15px] text-[color:var(--text)]
                placeholder:text-[color:var(--text-dim)]
                focus:outline-none focus:border-[color:var(--border-strong)]
              "
            />
          </div>
        </>
      )}

      {testOpen && (
        <TestSendDialog
          step2={step2}
          onClose={() => setTestOpen(false)}
        />
      )}
    </div>
  );
}

// ─── 테스트 발송 다이얼로그 ───────────────────────────────────

function TestSendDialog({
  step2,
  onClose,
}: {
  step2: ComposeStep2State;
  onClose: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [isPending, startTransition] = useTransition();
  const [resultMsg, setResultMsg] = useState<{
    tone: "success" | "danger" | "muted";
    text: string;
  } | null>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setResultMsg(null);
    const cleaned = phone.replace(/\D/g, "");
    if (!/^01[016789][0-9]{7,8}$/.test(cleaned)) {
      setResultMsg({
        tone: "danger",
        text: "휴대폰 번호 형식이 올바르지 않습니다. (예: 01012345678)",
      });
      return;
    }
    startTransition(async () => {
      const result = await testSendAction({
        step2: {
          templateId: step2.templateId,
          type: step2.type,
          subject: step2.subject,
          body: step2.body,
          isAd: step2.isAd,
        },
        toPhone: cleaned,
      });
      switch (result.status) {
        case "success":
          setResultMsg({
            tone: "success",
            text: `테스트 발송 완료. (성공 ${result.sent}건 / 실패 ${result.failed}건)`,
          });
          break;
        case "scheduled":
          setResultMsg({
            tone: "success",
            text: "테스트 발송이 예약되었습니다.",
          });
          break;
        case "blocked":
          setResultMsg({
            tone: "danger",
            text: result.reason,
          });
          break;
        case "failed":
          setResultMsg({
            tone: "danger",
            text: result.reason,
          });
          break;
        case "dev_seed_mode":
          setResultMsg({
            tone: "muted",
            text: result.reason,
          });
          break;
      }
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="test-send-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isPending) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !isPending) onClose();
      }}
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-xl bg-white border border-[color:var(--border)] shadow-lg p-6 space-y-4"
      >
        <h3
          id="test-send-title"
          className="text-[18px] font-semibold text-[color:var(--text)]"
        >
          테스트 발송
        </h3>
        <p className="text-[13px] text-[color:var(--text-muted)] leading-relaxed">
          본인 휴대폰 번호로 1건만 발송합니다. 캠페인 통계에는 집계되지 않으며,
          광고 가드와 야간 차단은 동일하게 적용됩니다.
        </p>

        <div className="space-y-1.5">
          <label
            htmlFor="test-phone"
            className="text-[14px] font-medium text-[color:var(--text)]"
          >
            받을 번호
          </label>
          <input
            id="test-phone"
            type="tel"
            inputMode="numeric"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="01012345678"
            disabled={isPending}
            className="
              w-full h-10 rounded-lg px-3
              bg-white border border-[color:var(--border)]
              text-[15px] text-[color:var(--text)]
              placeholder:text-[color:var(--text-dim)]
              focus:outline-none focus:border-[color:var(--border-strong)]
              disabled:opacity-50
            "
          />
        </div>

        {resultMsg && (
          <div
            role={resultMsg.tone === "danger" ? "alert" : "status"}
            className={
              resultMsg.tone === "success"
                ? "rounded-lg border border-[color:var(--success)] bg-[color:var(--success-bg)] px-3 py-2 text-[13px] text-[color:var(--text)]"
                : resultMsg.tone === "danger"
                  ? "rounded-lg border border-[color:var(--danger)] bg-[color:var(--danger-bg)] px-3 py-2 text-[13px] text-[color:var(--danger)]"
                  : "rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-3 py-2 text-[13px] text-[color:var(--text-muted)]"
            }
          >
            {resultMsg.text}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="
              inline-flex items-center h-10 px-4 rounded-lg
              border border-[color:var(--border)] bg-white
              text-[14px] text-[color:var(--text)]
              hover:bg-[color:var(--bg-hover)]
              disabled:opacity-50
              transition-colors
            "
          >
            닫기
          </button>
          <button
            type="submit"
            disabled={isPending || !phone.trim()}
            className="
              inline-flex items-center h-10 px-5 rounded-lg
              bg-[color:var(--action)] text-[color:var(--action-text)]
              text-[14px] font-medium
              hover:bg-[color:var(--action-hover)]
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors
            "
          >
            {isPending ? "발송 중..." : "발송"}
          </button>
        </div>
      </form>
    </div>
  );
}
