"use client";

import { useMemo, useRef } from "react";
import { AlertTriangle, Link as LinkIcon, Megaphone } from "lucide-react";
import type { ClassSignupOption, GroupListItem } from "@/types/database";
import { countEucKrBytes } from "@/lib/messaging/sms-bytes";
import { BYTE_LIMITS, type TemplateTypeLiteral } from "@/lib/schemas/template";
import { insertAdTag, insertUnsubscribeFooter } from "@/lib/messaging/guards";
import { PhonePreviewCard } from "@/components/messaging/phone-preview-card";
import { TestSendCard } from "@/components/messaging/test-send-card";
import { formatKstDateTime } from "@/lib/datetime";
import type { SeminarComposeState, SmsType } from "./seminar-compose-wizard";

/**
 * F5 · 설명회 발송 Step 3 — 본문 작성.
 *
 * 2026-06 개편: 상단에 유형·광고성·테스트발송을 모으고, 아래를 두 박스로 분리.
 *  - 상단 바: 유형 토글 · 광고성 토글.
 *  - 테스트 발송 카드(상단).
 *  - 박스 1 "세정학원 문자": 제목·본문 직접 입력(바이트는 라벨 옆 표기) + 변수 삽입.
 *  - 박스 2 "미리보기": PhonePreviewCard(읽기 전용) — (광고)·세정학원·무료수신거부
 *    및 {초대링크} 예시 URL 치환까지 실제 발송과 동일하게 시각화.
 *
 * 광고 가드(prefix/footer) 는 클라이언트에서도 동일 순수 함수로 즉시 계산해
 * 바이트 카운터·overflow 가 가공 결과 기준이 되게 한다. 서버 가드가 최종 검증선.
 *
 * 변수 토큰: 설명회는 sendon name 슬롯을 `{초대링크}` URL 치환에 hijack 하므로
 * `{이름}` 은 사용 불가 — 변수 삽입 버튼은 `{초대링크}` 만 노출한다.
 *
 * 바이트 한도: `{초대링크}` 는 발송 시 250바이트 안팎 URL 로 치환되므로 본문
 * 바이트 + 250 을 한도와 비교해 미리 경고한다.
 */

interface Props {
  state: SeminarComposeState;
  onChange: (patch: Partial<SeminarComposeState>) => void;
  selectedClasses: ClassSignupOption[];
  selectedGroup: GroupListItem | null;
  /** 환경변수 SMS_OPT_OUT_NUMBER — 광고 footer 미리보기에 표시. */
  optOutNumber: string;
}

/** `{초대링크}` 가 발송 시점에 치환되는 URL 의 예상 바이트 (sendon 단축 URL 미사용). */
const URL_RESERVED_BYTES = 250;

/** 미리보기 sample 에 노출할 예시 학생 토큰 URL. */
const SAMPLE_INVITE_URL = "https://sejung-crm.vercel.app/s/abc123XY";

const SUBJECT_BYTE_LIMIT = 40;

const TYPE_OPTIONS: Array<{
  value: TemplateTypeLiteral;
  label: string;
  hint: string;
}> = [
  { value: "LMS", label: "LMS · 장문", hint: "2,000바이트" },
  { value: "SMS", label: "SMS · 단문", hint: "90바이트" },
];

const INPUT_CLASS = `
  w-full h-11 rounded-lg px-3
  bg-bg-card border border-[color:var(--border)]
  text-[15px] text-[color:var(--text)]
  placeholder:text-[color:var(--text-dim)]
  focus:outline-none focus:border-[color:var(--border-strong)]
  transition-colors
`;

const TEXTAREA_CLASS = `
  w-full rounded-lg px-3 py-2.5 resize-y
  bg-bg-card border border-[color:var(--border)]
  text-[15px] leading-relaxed text-[color:var(--text)]
  placeholder:text-[color:var(--text-dim)]
  focus:outline-none focus:border-[color:var(--border-strong)]
  transition-colors
`;

export function SeminarComposeStep3Body({
  state,
  onChange,
  selectedClasses,
  selectedGroup,
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

  const subjectBytes = useMemo(
    () => (state.subject ? countEucKrBytes(state.subject) : 0),
    [state.subject],
  );
  const subjectOverflow = subjectBytes > SUBJECT_BYTE_LIMIT;

  const hasInviteVar = state.body.includes("{초대링크}");

  // 첫 강좌(설명회) 날짜 — sample 의 `{날짜}` 자리 치환 참고용.
  const sampleDateLabel = useMemo(() => {
    const primary = selectedClasses[0];
    if (!primary?.held_at) return null;
    return formatKstDateTime(primary.held_at);
  }, [selectedClasses]);

  // 미리보기 본문 — (광고) 머리(insertAdTag)만 반영하고 footer(무료수신거부)는
  // PhonePreviewCard 가 footer prop 으로 따로 렌더하므로 여기선 제외(중복 방지).
  // {초대링크} → 예시 URL, 변수 없으면 자동 부착, {날짜} → 첫 설명회 시간.
  const previewBody = useMemo(() => {
    let next = insertAdTag(state.body, state.isAd)
      .split("{초대링크}")
      .join(SAMPLE_INVITE_URL);
    if (!hasInviteVar && state.body.trim().length > 0) {
      next = `${next}\n신청하기: ${SAMPLE_INVITE_URL}`;
    }
    if (sampleDateLabel) {
      next = next.split("{날짜}").join(sampleDateLabel);
    }
    return next;
  }, [state.body, state.isAd, hasInviteVar, sampleDateLabel]);

  /** 변수 토큰을 본문 textarea 의 cursor 위치에 삽입. */
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
    <div className="space-y-5">
      <div>
        <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
          본문 작성
        </h2>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          왼쪽 &lsquo;세정학원 문자&rsquo; 칸에 제목·본문을 작성하면 오른쪽
          미리보기에 즉시 반영됩니다. 학생별 신청 URL 은 본문의{" "}
          <code className="text-[12px]">{`{초대링크}`}</code> 자리에 자동 치환되고,
          변수가 없으면 끝에 자동 부착됩니다.
        </p>
      </div>

      {/* ── 상단 바: 유형 · 광고성 ───────────────────────── */}
      <div className="rounded-xl border border-[color:var(--border)] bg-bg-card p-4 flex flex-col sm:flex-row sm:items-start gap-5">
        <fieldset className="space-y-1.5">
          <legend className="text-[12px] text-[color:var(--text-muted)]">
            유형
          </legend>
          <div className="flex gap-1.5">
            {TYPE_OPTIONS.map((opt) => {
              const checked = state.type === opt.value;
              return (
                <label
                  key={opt.value}
                  className={`
                    flex items-center justify-center gap-1.5 h-9 px-4 rounded-md border cursor-pointer text-[13px]
                    ${
                      checked
                        ? "border-[color:var(--action)] bg-[color:var(--bg-muted)] text-[color:var(--text)] font-medium"
                        : "border-[color:var(--border)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-hover)]"
                    }
                  `}
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

        <label className="flex items-start gap-2 cursor-pointer sm:pt-6">
          <input
            type="checkbox"
            checked={state.isAd}
            onChange={(e) => onChange({ isAd: e.target.checked })}
            className="mt-0.5 size-4 accent-[color:var(--action)]"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-[13px] font-medium text-[color:var(--text)]">
              광고성 문자
            </span>
            <span className="text-[11px] text-[color:var(--text-muted)] leading-relaxed">
              체크 시 제목 앞 (광고), 본문 머리 (광고)·세정학원, 끝에 080
              수신거부가 자동 삽입되고 바이트에 포함됩니다.
            </span>
          </span>
        </label>
      </div>

      {state.isAd && (
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

      {/* ── 테스트 발송 (위로) ───────────────────────────── */}
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

      {/* ── 2박스: 세정학원 문자 / 미리보기 ──────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* 박스 1 — 세정학원 문자 작성 */}
        <section
          aria-label="세정학원 문자 작성"
          className="rounded-xl border border-[color:var(--border)] bg-bg-card p-5 space-y-4"
        >
          <h3 className="text-[15px] font-semibold text-[color:var(--text)]">
            세정학원 문자
          </h3>

          {/* 제목 (LMS) */}
          {state.type === "LMS" && (
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <label
                  htmlFor="seminar-subject"
                  className="text-[13px] font-medium text-[color:var(--text)]"
                >
                  제목
                  {state.isAd && (
                    <span className="ml-1 text-[12px] font-normal text-[color:var(--text-muted)]">
                      (광고) 자동
                    </span>
                  )}
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
                id="seminar-subject"
                type="text"
                value={state.subject ?? ""}
                onChange={(e) => onChange({ subject: e.target.value })}
                placeholder="제목을 입력하세요"
                maxLength={40}
                className={INPUT_CLASS}
              />
            </div>
          )}

          {/* 변수 삽입 */}
          <div className="space-y-1.5">
            <span className="text-[12px] text-[color:var(--text-muted)]">
              변수 삽입
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={insertInviteToken}
                className="
                  inline-flex items-center gap-1 h-8 px-3 rounded-full
                  border border-[color:var(--border)] bg-bg-card
                  text-[12px] text-[color:var(--text)]
                  hover:bg-[color:var(--bg-hover)]
                  focus:outline-none focus:ring-2 focus:ring-[color:var(--border-strong)]
                  transition-colors
                "
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
            </div>
          </div>

          {/* 내용(본문) */}
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <label
                htmlFor="seminar-body"
                className="text-[13px] font-medium text-[color:var(--text)]"
              >
                내용
              </label>
              <span
                className={`text-[11px] tabular-nums ${
                  isOverLimit
                    ? "text-[color:var(--danger)] font-medium"
                    : "text-[color:var(--text-dim)]"
                }`}
                aria-live="polite"
              >
                {projectedBytes.toLocaleString()} / {limit.toLocaleString()}{" "}
                바이트
              </span>
            </div>
            <textarea
              id="seminar-body"
              ref={bodyRef}
              value={state.body}
              onChange={(e) => onChange({ body: e.target.value })}
              placeholder="문자 본문을 입력하세요."
              rows={10}
              className={TEXTAREA_CLASS}
              style={{ fontFamily: "var(--font-sans)" }}
            />
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
                <AlertTriangle
                  className="size-3.5"
                  strokeWidth={1.75}
                  aria-hidden
                />
                현재 {state.type} 한도({limit.toLocaleString()}바이트)를 넘습니다.{" "}
                {state.type === "SMS"
                  ? "LMS 로 바꾸거나 본문을 줄여주세요."
                  : "본문을 줄여주세요."}
              </p>
            )}
          </div>
        </section>

        {/* 박스 2 — 미리보기 */}
        <section
          aria-label="미리보기"
          className="rounded-xl border border-[color:var(--border)] bg-bg-card p-5 space-y-3"
        >
          <div className="flex items-baseline justify-between">
            <h3 className="text-[15px] font-semibold text-[color:var(--text)]">
              미리보기
            </h3>
            <span className="text-[11px] text-[color:var(--text-dim)]">
              예시 학생 기준
            </span>
          </div>

          <PhonePreviewCard
            type={state.type}
            subject={state.type === "LMS" ? state.subject : null}
            body={previewBody}
            isAd={state.isAd}
            rawBytes={projectedBytes}
            rawOverflow={isOverLimit}
            limit={limit}
            footer={
              state.isAd ? { unsubscribePhone: optOutNumber } : undefined
            }
          />

          <p className="text-[11px] text-[color:var(--text-dim)] leading-relaxed">
            실제 발송 시 <code>{`{초대링크}`}</code> 자리는 학생별
            <code className="ml-1">/s/&lt;토큰&gt;</code> URL 로 치환됩니다.
            {selectedGroup && (
              <>
                {" "}대상{" "}
                <strong className="text-[color:var(--text-muted)]">
                  {selectedGroup.name}
                </strong>
                {" "}· 약 {selectedGroup.recipient_count.toLocaleString()}명.
              </>
            )}
          </p>
        </section>
      </div>
    </div>
  );
}
