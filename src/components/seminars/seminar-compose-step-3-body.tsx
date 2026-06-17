"use client";

import { useMemo, useRef, type RefObject } from "react";
import { AlertTriangle, Link as LinkIcon, Megaphone } from "lucide-react";
import type { ClassSignupOption } from "@/types/database";
import { countEucKrBytes } from "@/lib/messaging/sms-bytes";
import { BYTE_LIMITS, type TemplateTypeLiteral } from "@/lib/schemas/template";
import {
  insertAdTag,
  insertAdSubjectTag,
  insertUnsubscribeFooter,
} from "@/lib/messaging/guards";
import { PhonePreviewCard } from "@/components/messaging/phone-preview-card";
import { TestSendCard } from "@/components/messaging/test-send-card";
import type { SeminarComposeState, SmsType } from "./seminar-compose-wizard";

/**
 * F5 · 설명회 발송 — 좌측 "문자 작성" 컬럼.
 *
 * 2026-06-16 개편: 일반 SMS /compose 와 동일하게 입력·미리보기 일체형으로 통일.
 * 옛 "작성 박스 / 미리보기 박스" 2단 구성을 버리고, 편집형 PhonePreviewCard
 * (폰 말풍선에 직접 타이핑) 하나로 합쳤다. 설명회 고유 요소만 유지:
 *  - 변수 삽입은 `{초대링크}` 만 (sendon name 슬롯을 URL 치환에 hijack).
 *  - `{초대링크}` 는 발송 시 ~250바이트 URL 로 치환되므로 본문 + 250 을 한도와 비교.
 *  - 테스트 발송은 선택 설명회 id·중복허용 값을 함께 넘긴다.
 *
 * 광고 가드(prefix/footer)는 클라이언트에서도 동일 순수 함수로 즉시 계산해
 * 바이트 카운터·overflow 가 가공 결과 기준이 되게 한다. 서버 가드가 최종 검증선.
 */

interface Props {
  state: SeminarComposeState;
  onChange: (patch: Partial<SeminarComposeState>) => void;
  selectedClasses: ClassSignupOption[];
  /** 체크된 대상 학생 수(미리보기 카드 헤더에 표시). */
  recipientCount: number;
  /** 환경변수 SMS_OPT_OUT_NUMBER — 광고 footer 미리보기에 표시. */
  optOutNumber: string;
}

/** `{초대링크}` 가 발송 시점에 치환되는 URL 의 예상 바이트 (sendon 단축 URL 미사용). */
const URL_RESERVED_BYTES = 250;

const SUBJECT_BYTE_LIMIT = 40;

const TYPE_OPTIONS: Array<{ value: TemplateTypeLiteral; label: string }> = [
  { value: "SMS", label: "SMS · 단문" },
  { value: "LMS", label: "LMS · 장문" },
];

export function SeminarComposeStep3Body({
  state,
  onChange,
  selectedClasses,
  recipientCount,
  optOutNumber,
}: Props) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // 광고 가드를 적용한 최종 본문 — 바이트 측정과 오버플로 판정의 기준.
  const clientFinalBody = useMemo(() => {
    const withAd = insertAdTag(state.body, state.isAd);
    return insertUnsubscribeFooter(withAd, state.isAd, optOutNumber);
  }, [state.body, state.isAd, optOutNumber]);

  const bodyBytesNoUrl = useMemo(
    () => countEucKrBytes(clientFinalBody),
    [clientFinalBody],
  );
  const limit = BYTE_LIMITS[state.type];
  const projectedBytes = bodyBytesNoUrl + URL_RESERVED_BYTES;
  const isOverLimit = projectedBytes > limit;

  // 광고면 제목 앞 (광고) 가 발송 시 붙으므로 바이트에도 포함해 센다.
  const subjectBytes = useMemo(() => {
    if (state.isAd && (state.subject ?? "").trim().length === 0) {
      return countEucKrBytes("(광고) ");
    }
    const s = insertAdSubjectTag(state.subject, state.isAd);
    return s ? countEucKrBytes(s) : 0;
  }, [state.subject, state.isAd]);
  const subjectOverflow = subjectBytes > SUBJECT_BYTE_LIMIT;

  const hasInviteVar = state.body.includes("{초대링크}");

  /** `{초대링크}` 토큰을 본문 textarea 의 cursor 위치에 삽입. */
  const insertInviteToken = () => {
    const ta = bodyRef.current;
    const current = state.body;
    const token = "{초대링크}";
    if (!ta) {
      onChange({ body: current + token });
      return;
    }
    const start = ta.selectionStart ?? current.length;
    const end = ta.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    onChange({ body: next });
    requestAnimationFrame(() => {
      const node = bodyRef.current;
      if (!node) return;
      const cursor = start + token.length;
      node.focus();
      node.setSelectionRange(cursor, cursor);
    });
  };

  const onTypeChange = (type: SmsType) => onChange({ type });

  return (
    <div className="space-y-4">
      <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
        문자 작성
      </h2>

      {/* 유형 */}
      <fieldset className="space-y-1.5">
        <legend className="text-[12px] text-[color:var(--text-muted)]">
          유형
        </legend>
        <div className="grid grid-cols-2 gap-1.5">
          {TYPE_OPTIONS.map((opt) => {
            const checked = state.type === opt.value;
            return (
              <label
                key={opt.value}
                className={`flex items-center justify-center gap-1.5 h-10 rounded-md border cursor-pointer text-[14px] ${
                  checked
                    ? "border-[color:var(--action)] bg-[color:var(--bg-muted)] text-[color:var(--text)] font-medium"
                    : "border-[color:var(--border)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-hover)]"
                }`}
              >
                <input
                  type="radio"
                  name="seminar-compose-type"
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

      {/* 미리보기 (editable) — 폰 말풍선에 직접 입력 */}
      <PhonePreviewCard
        type={state.type}
        subject={state.type === "LMS" ? state.subject : null}
        body={state.body}
        isAd={state.isAd}
        rawBytes={projectedBytes}
        rawOverflow={isOverLimit}
        limit={limit}
        editable
        onSubjectChange={(next) => onChange({ subject: next })}
        onBodyChange={(next) => onChange({ body: next })}
        bodyTextareaRef={bodyRef as RefObject<HTMLTextAreaElement>}
        footer={state.isAd ? { unsubscribePhone: optOutNumber } : undefined}
        recipientCount={recipientCount > 0 ? recipientCount : undefined}
      />

      {state.type === "LMS" && (
        <p
          className={`text-[11px] tabular-nums text-right ${
            subjectOverflow
              ? "text-[color:var(--danger)] font-medium"
              : "text-[color:var(--text-dim)]"
          }`}
          aria-live="polite"
        >
          제목 {subjectBytes} / {SUBJECT_BYTE_LIMIT} 바이트
        </p>
      )}

      <p className="text-[11px] text-[color:var(--text-dim)] leading-relaxed">
        본문 {bodyBytesNoUrl.toLocaleString()}바이트 + 학생별 URL{" "}
        {URL_RESERVED_BYTES}바이트 합산값입니다.
        {!hasInviteVar && " · 변수가 없어 끝에 자동 부착돼요."}
      </p>

      {isOverLimit && (
        <p
          role="alert"
          className="flex items-center gap-1.5 text-[12px] text-[color:var(--danger)]"
        >
          <AlertTriangle className="size-3.5" strokeWidth={1.75} aria-hidden />
          현재 {state.type} 한도({limit.toLocaleString()}바이트)를 넘습니다.{" "}
          {state.type === "SMS"
            ? "LMS 로 바꾸거나 본문을 줄여주세요."
            : "본문을 줄여주세요."}
        </p>
      )}

      {/* 변수 삽입 — 설명회는 {초대링크} 만 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[12px] text-[color:var(--text-muted)]">
          변수 삽입
        </span>
        <button
          type="button"
          onClick={insertInviteToken}
          className="inline-flex items-center gap-1 h-8 px-3 rounded-full border border-[color:var(--border)] bg-bg-card text-[12px] text-[color:var(--text)] hover:bg-[color:var(--bg-hover)] focus:outline-none focus:ring-2 focus:ring-[color:var(--border-strong)] transition-colors"
          aria-label="초대링크 변수 삽입"
        >
          <LinkIcon className="size-3.5" strokeWidth={1.75} aria-hidden />
          <span
            style={{
              fontFamily:
                "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
            }}
          >
            {"{초대링크}"}
          </span>
        </button>
        <span className="text-[11px] text-[color:var(--text-dim)]">
          학생별 신청 URL 로 치환됩니다.
        </span>
      </div>

      {/* 테스트 발송 */}
      <TestSendCard
        type={state.type}
        subject={state.subject}
        body={state.body.trim().length === 0 ? "" : state.body}
        isAd={state.isAd}
        seminarClassIds={selectedClasses.map((c) => c.class_id)}
        seminarAllowMultiple={state.allowMultiple}
        disabled={
          state.body.trim().length === 0 ||
          isOverLimit ||
          selectedClasses.length === 0
        }
      />

      {/* 발송 옵션 — 설명회는 광고성만 (대상 번호·동일번호는 invitation 모델상 미적용) */}
      <fieldset className="space-y-2 rounded-lg border border-[color:var(--border)] p-4">
        <legend className="flex items-center gap-1.5 px-1 text-[12px] text-[color:var(--text-muted)]">
          <Megaphone className="size-3.5" strokeWidth={1.75} aria-hidden />
          발송 옵션
        </legend>
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={state.isAd}
            onChange={(e) => onChange({ isAd: e.target.checked })}
            className="mt-0.5 size-4 accent-[color:var(--action)]"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-[14px] font-medium text-[color:var(--text)]">
              광고성 문자
            </span>
            <span className="text-[11px] text-[color:var(--text-muted)] leading-relaxed">
              체크 시 제목 앞 (광고), 본문 머리 (광고)·세정학원, 끝에 080
              수신거부가 자동 삽입되고 바이트에 포함됩니다.
            </span>
          </span>
        </label>
        {state.isAd && (
          <p className="flex items-start gap-2 text-[12px] leading-relaxed text-[color:var(--warning)]">
            <Megaphone
              className="size-3.5 mt-0.5 shrink-0"
              strokeWidth={1.75}
              aria-hidden
            />
            21시 ~ 08시 광고 발송이 차단됩니다.
          </p>
        )}
      </fieldset>
    </div>
  );
}
