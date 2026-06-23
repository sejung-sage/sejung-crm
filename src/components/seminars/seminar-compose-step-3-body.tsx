"use client";

import { useMemo, useRef } from "react";
import { AlertTriangle, Link as LinkIcon } from "lucide-react";
import type { ClassSignupOption } from "@/types/database";
import { countEucKrBytes } from "@/lib/messaging/sms-bytes";
import { BYTE_LIMITS, type TemplateTypeLiteral } from "@/lib/schemas/template";
import {
  insertSenderHeader,
  insertAdSubjectTag,
  insertUnsubscribeFooter,
  branchBrandName,
} from "@/lib/messaging/guards";
import { PhonePreviewCard } from "@/components/messaging/phone-preview-card";
import { TestSendCard } from "@/components/messaging/test-send-card";
import { formatKstDateTime } from "@/lib/datetime";
import type { SeminarComposeState, SmsType } from "./seminar-compose-wizard";

/**
 * F5 · 설명회 발송 — 본문 작성 (작성 박스 | 미리보기 박스 좌우 구성).
 *
 * 상단에 유형·광고성·테스트발송을 모으고, 아래를 두 박스로 분리한다.
 *  - 상단 바: 유형 토글 · 광고성 토글.
 *  - 테스트 발송 카드(상단 오른쪽).
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
  /** 체크된 대상 학생 수(미리보기 안내문에 표시). */
  recipientCount: number;
  /** 환경변수 SMS_OPT_OUT_NUMBER — 광고 footer 미리보기에 표시. */
  optOutNumber: string;
  /** 발송 분원 — 발신 브랜드명(분원별) 해석에 사용. */
  branch: string;
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
  w-full rounded-lg px-3 py-2.5 resize-none overflow-auto min-h-[10rem]
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
  recipientCount,
  optOutNumber,
  branch,
}: Props) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const brandName = useMemo(() => branchBrandName(branch), [branch]);

  // 브랜드 머리(+광고)·footer 가드 적용한 최종 본문 — 바이트 측정·오버플로 기준.
  const clientFinalBody = useMemo(() => {
    const withHeader = insertSenderHeader(state.body, state.isAd, brandName);
    return insertUnsubscribeFooter(withHeader, state.isAd, optOutNumber);
  }, [state.body, state.isAd, optOutNumber, brandName]);

  const bodyBytesNoUrl = useMemo(
    () => countEucKrBytes(clientFinalBody),
    [clientFinalBody],
  );
  const limit = BYTE_LIMITS[state.type];
  const projectedBytes = bodyBytesNoUrl + URL_RESERVED_BYTES;
  const isOverLimit = projectedBytes > limit;

  // 광고면 제목 앞 (광고) 가 발송 시 붙으므로 바이트에도 포함해 센다.
  // 빈 제목이어도 광고면 "(광고) " prefix 바이트를 표시한다(0 으로 보이지 않게).
  const subjectBytes = useMemo(() => {
    if (state.isAd && (state.subject ?? "").trim().length === 0) {
      return countEucKrBytes("(광고) ");
    }
    const s = insertAdSubjectTag(state.subject, state.isAd);
    return s ? countEucKrBytes(s) : 0;
  }, [state.subject, state.isAd]);
  const subjectOverflow = subjectBytes > SUBJECT_BYTE_LIMIT;

  const hasInviteVar = state.body.includes("{초대링크}");

  // 첫 강좌(설명회) 날짜 — sample 의 `{날짜}` 자리 치환 참고용.
  const sampleDateLabel = useMemo(() => {
    const primary = selectedClasses[0];
    if (!primary?.held_at) return null;
    return formatKstDateTime(primary.held_at);
  }, [selectedClasses]);

  // 미리보기 본문 — 브랜드 머리(+광고)는 insertSenderHeader 로 반영, footer(무료
  // 수신거부)는 PhonePreviewCard 가 footer prop 으로 따로 렌더하므로 제외(중복 방지).
  // {초대링크} → 예시 URL, 변수 없으면 자동 부착, {날짜} → 첫 설명회 시간.
  const previewBody = useMemo(() => {
    let next = insertSenderHeader(state.body, state.isAd, brandName)
      .split("{초대링크}")
      .join(SAMPLE_INVITE_URL);
    if (!hasInviteVar && state.body.trim().length > 0) {
      next = `${next}\n신청하기: ${SAMPLE_INVITE_URL}`;
    }
    if (sampleDateLabel) {
      next = next.split("{날짜}").join(sampleDateLabel);
    }
    return next;
  }, [state.body, state.isAd, hasInviteVar, sampleDateLabel, brandName]);

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
          문자 작성
        </h2>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          왼쪽 &lsquo;세정학원 문자&rsquo; 칸에 제목·본문을 작성하면 오른쪽
          미리보기에 즉시 반영됩니다. 학생별 신청 URL 은 본문의{" "}
          <code className="text-[12px]">{`{초대링크}`}</code> 자리에 자동 치환되고,
          변수가 없으면 끝에 자동 부착됩니다.
        </p>
      </div>

      {/* ── 상단: 유형·광고성 + 테스트 발송 (한 줄) ────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
        <div className="rounded-xl border border-[color:var(--border)] bg-bg-card p-4 flex flex-col sm:flex-row sm:items-start gap-x-6 gap-y-4">
          {/* 유형 */}
          <fieldset className="space-y-1.5 shrink-0">
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
                      flex items-center justify-center gap-1.5 h-9 px-4 rounded-md border cursor-pointer text-[13px] whitespace-nowrap
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

          {/* 세로 구분선 (sm 이상) */}
          <div
            className="hidden sm:block w-px self-stretch bg-[color:var(--border)]"
            aria-hidden
          />

          {/* 광고성 — 유형 버튼과 윗줄을 맞추려 라벨 높이만큼 빈 줄 확보 */}
          <div className="space-y-1.5 sm:flex-1 min-w-0">
            <span
              className="hidden sm:block text-[12px] invisible select-none"
              aria-hidden
            >
              유형
            </span>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={state.isAd}
                onChange={(e) => onChange({ isAd: e.target.checked })}
                className="mt-0.5 size-4 accent-[color:var(--action)]"
              />
              <span className="flex flex-col gap-1">
                <span className="text-[13px] font-medium text-[color:var(--text)]">
                  광고성 문자
                </span>
                <span className="text-[12px] text-[color:var(--text-muted)] leading-relaxed">
                  체크 시 제목 앞{" "}
                  <strong className="font-medium text-[color:var(--text)]">
                    (광고)
                  </strong>
                  , 본문 머리{" "}
                  <strong className="font-medium text-[color:var(--text)]">
                    (광고)·세정학원
                  </strong>
                  , 끝에{" "}
                  <strong className="font-medium text-[color:var(--text)]">
                    080 수신거부
                  </strong>
                  가 자동 삽입되고 바이트에 포함됩니다.
                </span>
              </span>
            </label>
          </div>
        </div>

        {/* 테스트 발송 — 유형·광고성과 한 줄 오른쪽 */}
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
      </div>


      {/* ── 2박스: 세정학원 문자 / 미리보기 ──────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
        {/* 박스 1 — 세정학원 문자 작성 */}
        <section
          aria-label="세정학원 문자 작성"
          className="rounded-xl border border-[color:var(--border)] bg-bg-card p-5 flex flex-col gap-4"
        >
          {/* 헤더: 제목 + 변수 삽입 */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-[15px] font-semibold text-[color:var(--text)]">
              세정학원 문자
            </h3>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[12px] text-[color:var(--text-muted)]">
                변수 삽입
              </span>
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

          {/* 내용(본문) */}
          <div className="flex-1 flex flex-col gap-1.5 min-h-0">
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
              className={`${TEXTAREA_CLASS} flex-1`}
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
            brandName={brandName}
          />

          <p className="text-[11px] text-[color:var(--text-dim)] leading-relaxed">
            실제 발송 시 <code>{`{초대링크}`}</code> 자리는 학생별
            <code className="ml-1">/s/&lt;토큰&gt;</code> URL 로 치환됩니다.
            {recipientCount > 0 && (
              <>
                {" "}대상{" "}
                <strong className="text-[color:var(--text-muted)] tabular-nums">
                  {recipientCount.toLocaleString()}명
                </strong>
                .
              </>
            )}
          </p>
        </section>
      </div>
    </div>
  );
}
