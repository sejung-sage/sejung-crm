"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { AlertTriangle, Loader2, Megaphone, Moon, Send, Users } from "lucide-react";
import type { GroupListItem, TemplateRow } from "@/types/database";
import type { PreviewResult } from "@/lib/messaging/preview-recipients";
import { useToast } from "@/components/ui/toast";
import {
  previewAction,
  testSendAction,
} from "@/app/(features)/compose/actions";
import { maskPhone } from "@/lib/phone";
import { PhonePreviewCard } from "@/components/messaging/phone-preview-card";
import { BYTE_LIMITS, type TemplateTypeLiteral } from "@/lib/schemas/template";
import { countEucKrBytes } from "@/lib/messaging/sms-bytes";
import type { ComposeStep2State } from "./compose-wizard";

/**
 * F3 Part B · Step 2 통합 — 작성 + 미리보기 + 캠페인 제목.
 *
 * 좌측: 발송 대상 / 수신자 샘플 / 비용.
 * 우측: 편집 input (유형/제목/본문/광고) + 실시간 핸드폰 미리보기 카드.
 *      본문 byte 카운트는 server 가드 적용 후 finalBody 기준이라 광고 머리말·
 *      080 수신거부 footer 가 자동 포함된 최종 byte 를 보여준다.
 *      제목 byte 도 LMS 일 때 실시간 표시.
 */
interface Props {
  groupId: string;
  selectedGroup: GroupListItem;
  step2: ComposeStep2State;
  onStep2Change: (s: ComposeStep2State) => void;
  templates: TemplateRow[];
  preview: PreviewResult | null;
  onPreview: (p: PreviewResult | null) => void;
  title: string;
  onTitleChange: (t: string) => void;
}

// LMS 제목은 64byte (한글 32자) 제한. SMS 는 제목 없음.
const SUBJECT_BYTE_LIMIT = 64;

const TYPE_OPTIONS: Array<{
  value: TemplateTypeLiteral;
  label: string;
  hint: string;
}> = [
  { value: "SMS", label: "SMS · 단문", hint: "90바이트" },
  { value: "LMS", label: "LMS · 장문", hint: "2000바이트" },
];

export function ComposeStep3Preview({
  groupId,
  selectedGroup,
  step2,
  onStep2Change,
  templates,
  preview,
  onPreview,
  title,
  onTitleChange,
}: Props) {
  const [loading, startLoading] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [testOpen, setTestOpen] = useState(false);

  // 제목 byte (LMS 만 표시).
  const subjectBytes = useMemo(
    () => (step2.subject ? countEucKrBytes(step2.subject) : 0),
    [step2.subject],
  );
  const subjectOverflow = subjectBytes > SUBJECT_BYTE_LIMIT;

  // 본문 byte — server 가드(광고 prefix + 080 footer) 적용된 finalBody 기준.
  // preview 가 아직 없으면 raw body 로 잠정 표시.
  const finalBodyBytes = preview
    ? countEucKrBytes(preview.finalBody)
    : countEucKrBytes(step2.body);
  const bodyLimit = BYTE_LIMITS[step2.type];
  const bodyOverflow = finalBodyBytes > bodyLimit;

  const onTypeChange = (type: TemplateTypeLiteral) => {
    if (type === "SMS") {
      onStep2Change({ ...step2, type, subject: null });
    } else {
      onStep2Change({ ...step2, type });
    }
  };

  const onPickTemplate = (id: string) => {
    if (!id) {
      onStep2Change({ ...step2, templateId: undefined });
      return;
    }
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    onStep2Change({
      templateId: t.id,
      type: t.type,
      subject: t.subject,
      body: t.body,
      isAd: t.is_ad,
    });
  };

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
            border border-[color:var(--border)] bg-bg-card
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

      {/* 본문이 비었거나 preview 가 아직이면 안내 (errorMsg 는 input 영역과 함께 표시).
          빈 본문 에러 메시지를 그대로 두면 사용자가 본문 입력 자체를 못 함 → input 은
          항상 보이도록 분리. */}
      {errorMsg && !loading && step2.body.trim().length > 0 && (
        <div
          role="alert"
          className="rounded-lg border border-[color:var(--danger)] bg-[color:var(--danger-bg)] px-4 py-3 text-[14px] text-[color:var(--danger)]"
        >
          {errorMsg}
        </div>
      )}

      {preview?.blockedByQuietHours && !loading && (
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

      {/* 메인 grid — preview 유무와 무관하게 항상 보임. input 입력 시 useEffect 가
          preview 재페치 + 우측 카드가 실시간 갱신. */}
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
          {!preview ? (
            <div className="text-[14px] text-[color:var(--text-muted)]">
              {step2.body.trim().length === 0
                ? "본문을 입력하면 수신자가 계산됩니다."
                : "계산 중..."}
            </div>
          ) : (
            <>
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
            </>
          )}
        </section>

        {/* 우: 편집 폼 + 실시간 미리보기 */}
        <div className="space-y-4">
              {/* 템플릿 빠른 불러오기 (선택) */}
              {templates.length > 0 && (
                <div className="space-y-1">
                  <label
                    htmlFor="compose-template"
                    className="text-[12px] text-[color:var(--text-muted)]"
                  >
                    저장된 템플릿 불러오기 (선택)
                  </label>
                  <select
                    id="compose-template"
                    value={step2.templateId ?? ""}
                    onChange={(e) => onPickTemplate(e.target.value)}
                    className="
                      w-full h-9 rounded-md px-2
                      bg-bg-card border border-[color:var(--border)]
                      text-[13px] text-[color:var(--text)]
                      focus:outline-none focus:border-[color:var(--border-strong)]
                      cursor-pointer
                    "
                  >
                    <option value="">— 새로 작성 —</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        [{t.type}] {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* 유형 */}
              <fieldset className="space-y-1.5">
                <legend className="text-[12px] text-[color:var(--text-muted)]">
                  유형
                </legend>
                <div className="grid grid-cols-2 gap-1.5">
                  {TYPE_OPTIONS.map((opt) => {
                    const checked = step2.type === opt.value;
                    return (
                      <label
                        key={opt.value}
                        className={`
                          flex items-center justify-center gap-1.5 h-9 rounded-md border cursor-pointer text-[13px]
                          ${
                            checked
                              ? "border-[color:var(--action)] bg-[color:var(--bg-muted)] text-[color:var(--text)] font-medium"
                              : "border-[color:var(--border)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-hover)]"
                          }
                        `}
                      >
                        <input
                          type="radio"
                          name="compose-type"
                          value={opt.value}
                          checked={checked}
                          onChange={() => onTypeChange(opt.value)}
                          className="sr-only"
                        />
                        <span>{opt.label}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              {/* 제목 (LMS 만) */}
              {step2.type !== "SMS" && (
                <div className="space-y-1">
                  <div className="flex items-baseline justify-between">
                    <label
                      htmlFor="compose-subject"
                      className="text-[12px] text-[color:var(--text-muted)]"
                    >
                      제목
                    </label>
                    <span
                      className={`text-[11px] tabular-nums ${
                        subjectOverflow
                          ? "text-[color:var(--danger)] font-medium"
                          : "text-[color:var(--text-dim)]"
                      }`}
                      aria-live="polite"
                    >
                      {subjectBytes} / {SUBJECT_BYTE_LIMIT} 바이트
                    </span>
                  </div>
                  <input
                    id="compose-subject"
                    type="text"
                    value={step2.subject ?? ""}
                    onChange={(e) =>
                      onStep2Change({ ...step2, subject: e.target.value })
                    }
                    placeholder="예: 세정학원 안내"
                    className={`
                      w-full h-9 rounded-md px-2.5
                      bg-bg-card border text-[14px] text-[color:var(--text)]
                      placeholder:text-[color:var(--text-dim)]
                      focus:outline-none
                      ${
                        subjectOverflow
                          ? "border-[color:var(--danger)] focus:border-[color:var(--danger)]"
                          : "border-[color:var(--border)] focus:border-[color:var(--border-strong)]"
                      }
                    `}
                  />
                </div>
              )}

              {/* 본문 */}
              <div className="space-y-1">
                <label
                  htmlFor="compose-body"
                  className="text-[12px] text-[color:var(--text-muted)]"
                >
                  본문
                </label>
                <textarea
                  id="compose-body"
                  value={step2.body}
                  onChange={(e) =>
                    onStep2Change({ ...step2, body: e.target.value })
                  }
                  placeholder="문자 본문을 입력하세요."
                  rows={6}
                  className="
                    w-full min-h-32 rounded-md p-2.5
                    bg-bg-card border border-[color:var(--border)]
                    text-[14px] leading-relaxed text-[color:var(--text)]
                    placeholder:text-[color:var(--text-dim)]
                    focus:outline-none focus:border-[color:var(--border-strong)]
                    resize-y
                  "
                  style={{ fontFamily: "var(--font-sans)" }}
                />
              </div>

              {/* 광고 체크 */}
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={step2.isAd}
                  onChange={(e) =>
                    onStep2Change({ ...step2, isAd: e.target.checked })
                  }
                  className="mt-0.5 size-4 accent-[color:var(--action)]"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-[13px] font-medium text-[color:var(--text)]">
                    광고성 문자
                  </span>
                  <span className="text-[11px] text-[color:var(--text-muted)]">
                    체크 시 [광고] 머리말 + 080 수신거부가 자동 삽입되고 바이트
                    합계에도 포함됩니다.
                  </span>
                </span>
              </label>

              {step2.isAd && (
                <div
                  role="note"
                  className="flex items-start gap-2 rounded-md border border-[color:var(--warning)] bg-[color:var(--warning-bg)] px-3 py-2"
                >
                  <Megaphone
                    className="size-3.5 mt-0.5 text-[color:var(--warning)] shrink-0"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <p className="text-[12px] leading-relaxed text-[color:var(--text)]">
                    21시 ~ 08시 광고 발송이 차단됩니다.
                  </p>
                </div>
              )}

              {bodyOverflow && (
                <p className="flex items-center gap-1.5 text-[12px] text-[color:var(--danger)]">
                  <AlertTriangle
                    className="size-3.5"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  현재 {step2.type} 한도({bodyLimit.toLocaleString()}바이트)를
                  초과했습니다.
                </p>
              )}

              {/* 실시간 미리보기 카드 — preview 있으면 finalBody (가드 적용),
                  없으면 step2.body raw fallback. */}
              <PhonePreviewCard
                type={step2.type}
                subject={step2.subject}
                body={preview ? preview.finalBody : step2.body}
                isAd={step2.isAd}
                rawBytes={finalBodyBytes}
                rawOverflow={bodyOverflow}
                limit={bodyLimit}
              />
              <p className="text-[11px] text-[color:var(--text-dim)] px-1">
                위 미리보기는 광고 머리말·080 수신거부가 자동 적용된 최종 발송본
                그대로입니다. 본문 바이트도 그 가공 결과 기준이에요.
              </p>
            </div>
      </div>

      {/* 비용 카드 + 캠페인 제목 — preview 있을 때만. */}
      {preview && !loading && (
        <>
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
                bg-bg-card border border-[color:var(--border)]
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
  const { show: showToast } = useToast();
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
        case "success": {
          const text = `테스트 발송 완료. (성공 ${result.sent}건 / 실패 ${result.failed}건)`;
          setResultMsg({ tone: "success", text });
          showToast(
            "success",
            `테스트 발송됐어요 — 성공 ${result.sent}건 / 실패 ${result.failed}건`,
          );
          break;
        }
        case "scheduled":
          setResultMsg({
            tone: "success",
            text: "테스트 발송이 예약되었습니다.",
          });
          showToast("success", "테스트 발송이 예약됐어요");
          break;
        case "blocked":
          setResultMsg({ tone: "danger", text: result.reason });
          showToast("error", `테스트 발송 차단: ${result.reason}`);
          break;
        case "failed":
          setResultMsg({ tone: "danger", text: result.reason });
          showToast("error", `테스트 발송 실패: ${result.reason}`);
          break;
        case "dev_seed_mode":
          setResultMsg({ tone: "muted", text: result.reason });
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
        className="w-full max-w-md rounded-xl bg-bg-card border border-[color:var(--border)] shadow-lg p-6 space-y-4"
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
              bg-bg-card border border-[color:var(--border)]
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
              border border-[color:var(--border)] bg-bg-card
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
