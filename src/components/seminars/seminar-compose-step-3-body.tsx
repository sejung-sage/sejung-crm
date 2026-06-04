"use client";

import { useMemo, useRef } from "react";
import { AlertTriangle, Link as LinkIcon, Megaphone } from "lucide-react";
import type { ClassSignupOption, GroupListItem } from "@/types/database";
import { countEucKrBytes } from "@/lib/messaging/sms-bytes";
import { BYTE_LIMITS, type TemplateTypeLiteral } from "@/lib/schemas/template";
import {
  insertAdTag,
  insertUnsubscribeFooter,
} from "@/lib/messaging/guards";
import { PhonePreviewCard } from "@/components/messaging/phone-preview-card";
import { TestSendCard } from "@/components/messaging/test-send-card";
import { formatKstDateTime } from "@/lib/datetime";
import type { SeminarComposeState, SmsType } from "./seminar-compose-wizard";

/**
 * F5 · 설명회 발송 Step 3 — 본문 작성.
 *
 * 2026-06 개편: 일반 `/compose` step3 와 동일한 톤으로 통합.
 *  - 좌측: 유형 토글 · 광고 토글 · 변수 삽입(`{초대링크}`) · 바이트 카운터·경고.
 *  - 우측: `PhonePreviewCard` editable 모드 — 제목·본문을 미리보기 말풍선에서
 *    직접 타이핑한다. 광고 토글 ON 일 때 footer 말풍선에 학원명·080 input 노출.
 *  - 광고 가드(prefix/footer) 는 클라이언트 단에서도 동일 순수 함수(`insertAdTag`,
 *    `insertUnsubscribeFooter`) 로 즉시 계산 → 바이트 카운터·overflow 가 가공
 *    결과 기준이 되도록 한다. 서버 가드는 최종 검증선이지만 UI 의 표시값과
 *    일치한다.
 *
 * 변수 토큰 정책:
 *  - 설명회는 sendon name 슬롯을 `{초대링크}` URL 치환에 hijack 한다
 *    (`actions.ts` 의 `INVITE_TOKEN` / `SENDON_INVITE_PLACEHOLDER` 참고).
 *    그래서 `{이름}` 변수는 사용 불가 — 변수 삽입 버튼은 `{초대링크}` 만 노출.
 *  - 미리보기 sample 말풍선에는 `{초대링크}` 자리를 예시 URL 로 치환해 보여줘
 *    수신자 입장을 가늠하게 한다.
 *
 * 바이트 한도:
 *  - 표시는 SMS 90 / LMS 2,000 (BYTE_LIMITS 와 동일 — 시스템 일관성).
 *  - 단, `{초대링크}` 자리는 발송 시 250바이트 안팎 URL 로 치환되므로 본문
 *    바이트 + 250 이 한도를 넘는지 별도로 안내한다 (서버는 finalBody 기준
 *    검증 — UI 가 먼저 경고만 띄움).
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

const TYPE_OPTIONS: Array<{
  value: TemplateTypeLiteral;
  label: string;
  hint: string;
}> = [
  { value: "LMS", label: "LMS · 장문", hint: "2,000바이트" },
  { value: "SMS", label: "SMS · 단문", hint: "90바이트" },
];

export function SeminarComposeStep3Body({
  state,
  onChange,
  selectedClasses,
  selectedGroup,
  optOutNumber,
}: Props) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // 광고 가드를 적용한 최종 본문 — 바이트 측정과 오버플로 판정의 기준.
  // 발송 시 `{초대링크}` 가 학생별 URL 로 치환되므로 그 바이트는 별도 합산.
  const clientFinalBody = useMemo(() => {
    const withAd = insertAdTag(state.body, state.isAd);
    return insertUnsubscribeFooter(withAd, state.isAd, optOutNumber);
  }, [state.body, state.isAd, optOutNumber]);

  const bodyBytesNoUrl = useMemo(
    () => countEucKrBytes(clientFinalBody),
    [clientFinalBody],
  );
  const limit = BYTE_LIMITS[state.type];
  // {초대링크} 가 본문에 있으면 발송 시 그 위치가 URL 로 치환 → 250 바이트 추가.
  // 없으면 backend 가 본문 끝에 자동 부착 → 동일하게 250 바이트 추가.
  const projectedBytes = bodyBytesNoUrl + URL_RESERVED_BYTES;
  const isOverLimit = projectedBytes > limit;

  // 제목 바이트 (LMS 만). EUC-KR 40바이트 권장.
  const subjectBytes = useMemo(
    () => (state.subject ? countEucKrBytes(state.subject) : 0),
    [state.subject],
  );
  const SUBJECT_BYTE_LIMIT = 40;
  const subjectOverflow = subjectBytes > SUBJECT_BYTE_LIMIT;

  const hasInviteVar = state.body.includes("{초대링크}");

  // 첫 강좌(설명회) 날짜 — sample 말풍선의 `{날짜}` 자리 치환 참고용(선택).
  const sampleDateLabel = useMemo(() => {
    const primary = selectedClasses[0];
    if (!primary?.held_at) return null;
    return formatKstDateTime(primary.held_at);
  }, [selectedClasses]);

  // 미리보기 sample 본문 — {초대링크} → 예시 URL, {날짜} → 첫 설명회 시간.
  // {초대링크} 가 본문에 없으면 발송 시 자동 부착되는 동작을 시각화.
  const sampleBody = useMemo(() => {
    let next = clientFinalBody.split("{초대링크}").join(SAMPLE_INVITE_URL);
    if (!hasInviteVar && next.trim().length > 0) {
      next = `${next}\n신청하기: ${SAMPLE_INVITE_URL}`;
    }
    if (sampleDateLabel) {
      next = next.split("{날짜}").join(sampleDateLabel);
    }
    return next;
  }, [clientFinalBody, hasInviteVar, sampleDateLabel]);

  /** 변수 토큰을 미리보기 본문 textarea 의 cursor 위치에 삽입. */
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

  const onTypeChange = (type: SmsType) => {
    if (type === "SMS") {
      // SMS 전환 시에도 subject 는 state 에 보존 — LMS 로 다시 가면 복원.
      onChange({ type });
    } else {
      onChange({ type });
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
          본문 작성
        </h2>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          오른쪽 미리보기 말풍선에서 바로 제목·본문을 작성하세요. 학생별 신청
          URL 은 본문의 <code className="text-[12px]">{`{초대링크}`}</code> 자리에
          자동 치환됩니다. 변수가 없으면 본문 끝에 자동 부착됩니다.
        </p>
      </div>

      {/* 2 column — 좌: 메타 컨트롤 / 우: editable 미리보기(sticky) */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_480px] gap-6 items-start">
        {/* ── 좌: 메타 컨트롤 ─────────────────────────── */}
        <div className="space-y-4 min-w-0">
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
            <p className="text-[11px] text-[color:var(--text-dim)]">
              설명회 안내는 본문이 길어 LMS 가 기본입니다.
            </p>
          </fieldset>

          {/* 제목 byte 카운트 (LMS) — 입력은 미리보기에서 직접. */}
          {state.type === "LMS" && (
            <div className="space-y-1">
              <div className="flex items-baseline justify-between">
                <span className="text-[12px] text-[color:var(--text-muted)]">
                  제목 바이트
                </span>
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
                <LinkIcon
                  className="size-3.5"
                  strokeWidth={1.75}
                  aria-hidden
                />
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
            <p className="text-[11px] text-[color:var(--text-dim)] leading-relaxed">
              발송 시 학생별 신청 URL 로 자동 치환됩니다. 본문에 변수가 없으면
              끝에 자동 부착돼요.
            </p>
          </div>

          {/* 광고 토글 */}
          <label className="flex items-start gap-2 cursor-pointer pt-1">
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
              <span className="text-[11px] text-[color:var(--text-muted)]">
                체크 시 [광고] 머리말 + 080 수신거부가 자동 삽입되고 바이트
                합계에도 포함됩니다.
              </span>
            </span>
          </label>

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

          {/* 바이트 안내 — URL 예약분 별도 표기. */}
          <div className="space-y-1 pt-1">
            <div className="flex items-baseline justify-between text-[12px]">
              <span className="text-[color:var(--text-muted)]">
                본문 바이트 (예상)
              </span>
              <span
                className={`tabular-nums ${
                  isOverLimit
                    ? "text-[color:var(--danger)] font-medium"
                    : "text-[color:var(--text)]"
                }`}
                aria-live="polite"
              >
                {projectedBytes.toLocaleString()} / {limit.toLocaleString()}
              </span>
            </div>
            <p className="text-[11px] text-[color:var(--text-dim)] leading-relaxed">
              본문 {bodyBytesNoUrl.toLocaleString()}바이트 + 학생별 URL {URL_RESERVED_BYTES}바이트
              합산값입니다.
              {!hasInviteVar && " · 변수가 없어 끝에 자동 부착돼요."}
            </p>
          </div>

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

        {/* ── 우: editable 미리보기 (sticky) ────────── */}
        <aside className="space-y-2 lg:sticky lg:top-4 self-start">
          <PhonePreviewCard
            type={state.type}
            subject={state.subject}
            body={state.body}
            isAd={state.isAd}
            // 카드 footer 의 바이트 표기도 동일 기준(가공 본문 + URL 예약).
            rawBytes={projectedBytes}
            rawOverflow={isOverLimit}
            limit={limit}
            editable
            onSubjectChange={(next) => onChange({ subject: next })}
            onBodyChange={(next) => onChange({ body: next })}
            bodyTextareaRef={bodyRef}
            footer={
              state.isAd
                ? {
                    academyName: "세정학원",
                    unsubscribePhone: optOutNumber,
                  }
                : undefined
            }
          />

          {/* 변수 치환 예시 — `{초대링크}` 자리에 예시 URL 박힌 결과 노출.
              editable 모드의 본문 말풍선엔 raw 가 그대로 보이므로 보조 안내. */}
          <div className="space-y-1.5 pt-1">
            <p className="text-[11px] text-[color:var(--text-muted)] px-1">
              예시 학생 기준 미리보기
            </p>
            <div
              className="
                rounded-2xl rounded-tl-md
                border border-dashed border-[color:var(--border-strong)]
                bg-bg-card
                px-4 py-3 space-y-2
              "
              aria-label="변수 치환 예시"
            >
              {state.type === "LMS" && state.subject && (
                <p className="text-[15px] font-semibold text-[color:var(--text)] leading-tight">
                  {state.subject}
                </p>
              )}
              <pre
                className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-[color:var(--text)] font-sans"
                style={{ fontFamily: "var(--font-sans)" }}
              >
                {sampleBody ||
                  "본문을 입력하면 예시가 여기에 표시됩니다."}
              </pre>
            </div>
            <p className="text-[11px] text-[color:var(--text-dim)] px-1 leading-relaxed">
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
          </div>

          {/* 테스트 발송 — 본인 번호 1건. 설명회 모드: raw 본문(`{초대링크}` 포함)을
              그대로 넘기면 서버가 실제 학생 토큰 URL 로 치환하고 inviteUrl 을
              돌려준다(가짜 SAMPLE_INVITE_URL 클라 치환 X). 광고 prefix·080
              footer 는 seminarTestSendAction 내부에서 적용됨(중복 X).
              선택된 설명회가 0개면 서버가 classIds 를 못 받으므로 disabled. */}
          <TestSendCard
            type={state.type}
            subject={state.subject}
            body={state.body.trim().length === 0 ? "" : state.body}
            isAd={state.isAd}
            seminarClassIds={selectedClasses.map((c) => c.class_id)}
            disabled={
              state.body.trim().length === 0 ||
              isOverLimit ||
              selectedClasses.length === 0
            }
          />
        </aside>
      </div>
    </div>
  );
}
