"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Megaphone,
  Send,
  UserRound,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { byteProgress } from "@/lib/messaging/sms-bytes";
import { applyNameToken } from "@/lib/messaging/personalize";
import {
  BYTE_LIMITS,
  type TemplateTypeLiteral,
} from "@/lib/schemas/template";
import { excelSendAction } from "@/app/(features)/excel-send/actions";
import { buildSendRecipients, type ParsedRecipientRow } from "./excel-parse";

interface Props {
  rows: ParsedRecipientRow[];
}

const TYPE_OPTIONS: Array<{
  value: TemplateTypeLiteral;
  label: string;
  hint: string;
}> = [
  { value: "SMS", label: "단문 (SMS)", hint: "90바이트 · 한글 약 45자" },
  { value: "LMS", label: "장문 (LMS)", hint: "2,000바이트 · 한글 약 1,000자" },
];

/**
 * 엑셀 보내기 ④ 본문 작성 + ⑤ 발송.
 *
 * - 유형(SMS/LMS) 토글, LMS 제목, 본문(+{이름} 삽입), 광고 토글, 바이트 카운터.
 * - 미리보기 말풍선: 첫 정상 행의 이름으로 {이름} 치환.
 * - 발송: 잘못된 번호 제외 + 중복 1회 정리한 명단을 excelSendAction 으로 전송.
 */
export function ExcelComposePanel({ rows }: Props) {
  const { show } = useToast();
  const router = useRouter();
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const [type, setType] = useState<TemplateTypeLiteral>("SMS");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [isAd, setIsAd] = useState(false);
  const [sending, startSend] = useTransition();

  const sendRecipients = useMemo(() => buildSendRecipients(rows), [rows]);
  const firstName = useMemo(() => {
    const first = rows.find((r) => r.status === "ok");
    return first?.name?.trim() || null;
  }, [rows]);

  const progress = byteProgress(body, type);
  const overflow = progress.bytes > progress.limit;
  const subjectRequired = type !== "SMS";
  const bodyEmpty = body.trim() === "";
  const noRecipients = sendRecipients.length === 0;

  const disabled = sending || bodyEmpty || overflow || noRecipients;

  const onTypeChange = (next: TemplateTypeLiteral) => {
    setType(next);
    if (next === "SMS") setSubject("");
  };

  // {이름} 토큰을 커서 위치에 삽입.
  const insertNameToken = () => {
    const el = bodyRef.current;
    if (!el) {
      setBody((b) => b + "{이름}");
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + "{이름}" + body.slice(end);
    setBody(next);
    // 삽입 후 커서를 토큰 뒤로.
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + "{이름}".length;
      el.setSelectionRange(pos, pos);
    });
  };

  // 미리보기 말풍선 — 첫 정상 행 이름으로 치환(없으면 "학부모님").
  const previewBody = applyNameToken(body, firstName);

  const handleSend = () => {
    if (disabled) return;
    startSend(async () => {
      const result = await excelSendAction({
        recipients: sendRecipients,
        type,
        subject: subjectRequired ? subject.trim() || null : null,
        body,
        isAd,
      });

      switch (result.status) {
        case "success": {
          const parts = [`발송 ${result.sent.toLocaleString()}건 접수`];
          if (result.skippedUnsub > 0)
            parts.push(`수신거부 제외 ${result.skippedUnsub.toLocaleString()}`);
          if (result.skippedInvalid > 0)
            parts.push(`잘못된 번호 ${result.skippedInvalid.toLocaleString()}`);
          if (result.deduped > 0)
            parts.push(`중복 ${result.deduped.toLocaleString()}`);
          show("success", parts.join(" · "));
          router.push(`/campaigns/${result.campaignId}`);
          break;
        }
        case "blocked":
          show("error", result.reason || "발송이 차단되었습니다.");
          break;
        case "dev_seed_mode":
          show(
            "error",
            "개발용 시드 모드에서는 실제 발송이 차단됩니다.",
          );
          break;
        case "failed":
        default:
          show(
            "error",
            ("reason" in result && result.reason) ||
              "발송에 실패했습니다. 잠시 후 다시 시도해주세요.",
          );
          break;
      }
    });
  };

  return (
    <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-card)] p-5 space-y-5">
      <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
        4. 문자 내용 작성
      </h2>

      {/* 유형 */}
      <fieldset className="space-y-2">
        <legend className="text-[14px] font-medium text-[color:var(--text)]">
          유형
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {TYPE_OPTIONS.map((opt) => {
            const checked = type === opt.value;
            return (
              <label
                key={opt.value}
                className={`
                  flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors
                  ${
                    checked
                      ? "border-[color:var(--action)] bg-[color:var(--bg-muted)]"
                      : "border-[color:var(--border)] hover:bg-[color:var(--bg-hover)]"
                  }
                `}
              >
                <input
                  type="radio"
                  name="excel-send-type"
                  value={opt.value}
                  checked={checked}
                  onChange={() => onTypeChange(opt.value)}
                  className="mt-1 size-4 accent-[color:var(--action)]"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-[14px] font-medium text-[color:var(--text)]">
                    {opt.label}
                  </span>
                  <span className="text-[12px] text-[color:var(--text-muted)]">
                    {opt.hint}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* 제목 (LMS 전용) */}
      <div className="space-y-1.5">
        <label
          htmlFor="excel-send-subject"
          className="text-[14px] font-medium text-[color:var(--text)]"
        >
          제목
          {!subjectRequired && (
            <span className="ml-2 text-[12px] text-[color:var(--text-dim)]">
              SMS 는 제목 없음
            </span>
          )}
        </label>
        <input
          id="excel-send-subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          disabled={!subjectRequired}
          placeholder={subjectRequired ? "예: 세정학원 안내" : "—"}
          maxLength={40}
          className="
            w-full h-10 rounded-lg px-3
            bg-[color:var(--bg-card)] border border-[color:var(--border)]
            text-[15px] text-[color:var(--text)]
            placeholder:text-[color:var(--text-dim)]
            focus:outline-none focus:border-[color:var(--border-strong)]
            disabled:bg-[color:var(--bg-muted)] disabled:text-[color:var(--text-dim)]
            disabled:cursor-not-allowed
          "
        />
      </div>

      {/* 본문 */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label
            htmlFor="excel-send-body"
            className="text-[14px] font-medium text-[color:var(--text)]"
          >
            본문
          </label>
          <button
            type="button"
            onClick={insertNameToken}
            className="
              inline-flex items-center gap-1
              h-8 px-2.5 rounded-md
              text-[13px] font-medium text-[color:var(--text-muted)]
              border border-[color:var(--border)] bg-[color:var(--bg-card)]
              hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text)]
              focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--action)] focus-visible:ring-offset-1
              transition-colors
            "
          >
            <UserRound className="size-3.5" strokeWidth={1.75} aria-hidden />
            {"{이름}"} 넣기
          </button>
        </div>
        <textarea
          id="excel-send-body"
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="문자 본문을 입력하세요. {이름} 을 넣으면 받는 분 이름으로 바뀝니다."
          rows={7}
          className="
            w-full min-h-36 rounded-lg p-3
            bg-[color:var(--bg-card)] border border-[color:var(--border)]
            text-[15px] leading-relaxed text-[color:var(--text)]
            placeholder:text-[color:var(--text-dim)]
            focus:outline-none focus:border-[color:var(--border-strong)]
            transition-colors resize-y
          "
          style={{ fontFamily: "var(--font-sans)" }}
        />
        <div className="flex items-center justify-between">
          <p className="text-[12px] text-[color:var(--text-muted)]">
            {"{이름}"} 변수는 받는 분 이름으로 자동 치환됩니다.
          </p>
          <p
            className={`text-[13px] tabular-nums ${
              overflow
                ? "text-[color:var(--danger)] font-medium"
                : "text-[color:var(--text-muted)]"
            }`}
            aria-live="polite"
          >
            {progress.bytes.toLocaleString()} /{" "}
            {progress.limit.toLocaleString()} 바이트
            {overflow && <span className="ml-2">한도 초과</span>}
          </p>
        </div>
        {overflow && (
          <p className="flex items-center gap-1.5 text-[12px] text-[color:var(--danger)]">
            <AlertTriangle className="size-3.5" strokeWidth={1.75} aria-hidden />
            현재 {type} 한도({BYTE_LIMITS[type]}바이트)를 초과했습니다. 본문을
            줄이거나 LMS 로 유형을 변경하세요.
          </p>
        )}
      </div>

      {/* 미리보기 말풍선 */}
      {body.trim() !== "" && (
        <div className="space-y-1.5">
          <p className="text-[13px] font-medium text-[color:var(--text-muted)]">
            미리보기
            {firstName && (
              <span className="ml-1 text-[12px] text-[color:var(--text-dim)]">
                ({firstName} 님 기준)
              </span>
            )}
          </p>
          <div className="max-w-md rounded-2xl rounded-tl-sm border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-4 py-3">
            {subjectRequired && subject.trim() !== "" && (
              <p className="mb-1 text-[14px] font-semibold text-[color:var(--text)]">
                {subject}
              </p>
            )}
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-[color:var(--text)]">
              {previewBody}
            </p>
          </div>
        </div>
      )}

      {/* 광고 토글 */}
      <div className="space-y-2">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={isAd}
            onChange={(e) => setIsAd(e.target.checked)}
            className="mt-1 size-4 accent-[color:var(--action)]"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-[14px] font-medium text-[color:var(--text)]">
              광고성 문자로 발송
            </span>
            <span className="text-[12px] text-[color:var(--text-muted)]">
              모집·특강·이벤트 등 마케팅 메시지면 체크하세요.
            </span>
          </span>
        </label>

        {isAd && (
          <div
            role="note"
            className="flex items-start gap-2 rounded-lg border border-[color:var(--warning)] bg-[color:var(--warning-bg)] px-4 py-3"
          >
            <Megaphone
              className="size-4 mt-0.5 text-[color:var(--warning)]"
              strokeWidth={1.75}
              aria-hidden
            />
            <div className="text-[13px] leading-relaxed text-[color:var(--text)]">
              <strong className="font-medium">광고 발송 안전 가드:</strong> 본문
              앞에 <code className="px-1 rounded bg-[color:var(--bg-card)]">[광고]</code>{" "}
              prefix 와 끝에{" "}
              <code className="px-1 rounded bg-[color:var(--bg-card)]">080 수신거부</code>{" "}
              안내가 자동 삽입됩니다.
            </div>
          </div>
        )}
      </div>

      {/* 발송 */}
      <div className="flex flex-col gap-2 border-t border-[color:var(--border)] pt-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] text-[color:var(--text-muted)]" aria-live="polite">
            발송 대상{" "}
            <span className="font-semibold text-[color:var(--text)] tabular-nums">
              {sendRecipients.length.toLocaleString()}
            </span>
            명
          </p>
          <button
            type="button"
            onClick={handleSend}
            disabled={disabled}
            className="
              inline-flex items-center justify-center gap-1.5
              h-11 px-6 rounded-lg
              text-[15px] font-semibold
              text-[color:var(--action-text)] bg-[color:var(--action)]
              hover:bg-[color:var(--action-hover)]
              focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--action)] focus-visible:ring-offset-1
              disabled:opacity-50 disabled:cursor-not-allowed
              transition
            "
          >
            <Send className="size-4" strokeWidth={1.75} aria-hidden />
            {sending ? "발송 중..." : "발송하기"}
          </button>
        </div>
        {noRecipients && (
          <p className="text-[12px] text-[color:var(--text-muted)]">
            발송할 정상 번호가 없습니다. 명단을 다시 확인해주세요.
          </p>
        )}
      </div>
    </section>
  );
}
