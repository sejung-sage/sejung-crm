"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { AlertTriangle, BookmarkPlus, Link as LinkIcon } from "lucide-react";
import type { ClassSignupOption, TemplateRow } from "@/types/database";
import { countEucKrBytes } from "@/lib/messaging/sms-bytes";
import { BYTE_LIMITS, type TemplateTypeLiteral } from "@/lib/schemas/template";
import {
  insertSenderHeader,
  insertAdSubjectTag,
  insertUnsubscribeFooter,
  branchBrandName,
} from "@/lib/messaging/guards";
import { createTemplateAction } from "@/app/(features)/templates/actions";
import { PhonePreviewCard } from "@/components/messaging/phone-preview-card";
import { TestSendCard } from "@/components/messaging/test-send-card";
import { applyDateToken } from "@/lib/messaging/personalize";
import type { Division } from "@/config/divisions";
import type { SeminarComposeState, SmsType } from "./seminar-compose-wizard";

/**
 * F5 · 설명회 발송 — 본문 작성 (작성 박스 | 미리보기 박스 좌우 구성).
 *
 * 상단에 유형·광고성·테스트발송을 모으고, 아래를 두 박스로 분리한다.
 *  - 상단 바: 유형 토글 · 광고성 토글 · 상용문구(불러오기 + 현재 내용 저장).
 *  - 테스트 발송 카드(상단 오른쪽).
 *  - 박스 1 "세정학원 문자": 제목·본문 직접 입력(바이트는 라벨 옆 표기) + 변수 삽입.
 *  - 박스 2 "미리보기": PhonePreviewCard(읽기 전용) — (광고)·세정학원·무료수신거부
 *    및 {초대링크} 예시 URL 치환까지 실제 발송과 동일하게 시각화.
 *
 * 광고 가드(prefix/footer) 는 클라이언트에서도 동일 순수 함수로 즉시 계산해
 * 바이트 카운터·overflow 가 가공 결과 기준이 되게 한다. 서버 가드가 최종 검증선.
 *
 * 변수 토큰: 설명회는 sendon name 슬롯을 `{초대링크}` URL 치환에 hijack 하므로
 * `{이름}` 은 사용 불가(서버 createSeminarBroadcastAction 이 blocked 로 거절).
 * `{날짜}` 는 모든 수신자가 같은 값이라 drain-campaign 이 발송 직전 1회 치환하므로
 * 사용 가능 — 변수 삽입 버튼은 `{초대링크}` · `{날짜}` 두 개만 노출한다.
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
  /** 발신 명의(division) — 브랜드명(수학관 반영)·테스트 발송에 사용. */
  senderDivision: Division;
  /** 상용문구 — 분원 기준 목록(불러오기 셀렉트의 초기값). */
  templates: TemplateRow[];
}

/**
 * 셀렉트·불러오기에 필요한 최소 필드만 (일반 /compose 와 동일한 축약형).
 * 저장 직후 서버 왕복 없이 목록에 끼워 넣어야 해서 created_at 같은 서버 값은 뺀다.
 */
type ComposeTemplate = Pick<
  TemplateRow,
  "id" | "name" | "type" | "subject" | "body" | "is_ad"
>;

function toComposeTemplate(t: TemplateRow): ComposeTemplate {
  return {
    id: t.id,
    name: t.name,
    type: t.type,
    subject: t.subject,
    body: t.body,
    is_ad: t.is_ad,
  };
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
  senderDivision,
  templates,
}: Props) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // 상용문구 — 목록은 서버가 내려주지만 이 화면에서 바로 저장할 수 있으므로
  // 로컬 state 로 들고 새로 만든 문구를 즉시 셀렉트에 반영한다(새로고침 없이).
  const [templateList, setTemplateList] = useState<ComposeTemplate[]>(() =>
    templates.map(toComposeTemplate),
  );
  const [templateId, setTemplateId] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();

  const brandName = useMemo(
    () => branchBrandName(branch, senderDivision),
    [branch, senderDivision],
  );

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

  // 미리보기 본문 — 브랜드 머리(+광고)는 insertSenderHeader 로 반영, footer(무료
  // 수신거부)는 PhonePreviewCard 가 footer prop 으로 따로 렌더하므로 제외(중복 방지).
  // {초대링크} → 예시 URL, 변수 없으면 자동 부착.
  // {날짜} → 발송일 'M월 D일' — 실제 발송(drain-campaign)이 applyDateToken 으로
  // 같은 치환을 하므로 동일 함수를 써서 미리보기가 실제와 어긋나지 않게 한다.
  const previewBody = useMemo(() => {
    let next = insertSenderHeader(state.body, state.isAd, brandName)
      .split("{초대링크}")
      .join(SAMPLE_INVITE_URL);
    if (!hasInviteVar && state.body.trim().length > 0) {
      next = `${next}\n신청하기: ${SAMPLE_INVITE_URL}`;
    }
    return applyDateToken(next, new Date());
  }, [state.body, state.isAd, hasInviteVar, brandName]);

  /** 변수 토큰을 본문 textarea 의 cursor 위치에 삽입. */
  const insertToken = (token: string) => {
    const ta = bodyRef.current;
    const current = state.body;
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

  /** 저장된 상용문구를 불러와 유형·제목·본문·광고성을 한 번에 채운다. */
  const onPickTemplate = (id: string) => {
    setTemplateId(id);
    if (!id) return;
    const t = templateList.find((x) => x.id === id);
    if (!t) return;
    onChange({
      type: t.type,
      subject: t.subject,
      body: t.body,
      isAd: t.is_ad,
    });
  };

  /**
   * 지금 작성 중인 설명회 문자를 상용문구로 저장 (일반 /compose 와 동일 규약).
   * `{초대링크}` 변수도 그대로 저장돼 다음 설명회에서 바로 재사용된다.
   *
   * 저장 분원은 발송 분원(branch). 서버는 master 일 때만 이 값을 쓰고 그 외
   * 역할은 본인 분원으로 강제한다.
   */
  const handleSaveTemplate = () => {
    const name = saveName.trim();
    const body = state.body.trim();
    const subject = state.subject?.trim() ?? "";
    setSaveError(null);
    setSaveNotice(null);

    if (!name) {
      setSaveError("문구 이름을 입력하세요.");
      return;
    }
    if (!body) {
      setSaveError("본문을 먼저 입력하세요.");
      return;
    }
    if (state.type === "LMS" && !subject) {
      setSaveError("LMS 는 제목이 있어야 저장할 수 있습니다.");
      return;
    }

    startSaving(async () => {
      const result = await createTemplateAction({
        name,
        type: state.type,
        subject: state.type === "SMS" ? null : subject,
        body,
        is_ad: state.isAd,
        branch,
      });
      if (result.status === "success") {
        const saved: ComposeTemplate = {
          id: result.id,
          name,
          type: state.type,
          subject: state.type === "SMS" ? null : subject,
          body,
          is_ad: state.isAd,
        };
        setTemplateList((prev) => [...prev, saved]);
        setTemplateId(saved.id);
        setSaveOpen(false);
        setSaveName("");
        setSaveNotice(`'${name}' 문구를 저장했어요.`);
      } else if (result.status === "dev_seed_mode") {
        setSaveError("개발용 시드 모드라 저장되지 않습니다.");
      } else {
        setSaveError(result.reason);
      }
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
        <div className="rounded-xl border border-[color:var(--border)] bg-bg-card p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-start gap-x-6 gap-y-4">
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

          {/* 상용문구 — 불러오기 + 이 화면에서 바로 저장 */}
          <div className="space-y-1.5 border-t border-[color:var(--border)] pt-4">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="seminar-template"
                className="text-[12px] text-[color:var(--text-muted)]"
              >
                상용문구
              </label>
              <button
                type="button"
                onClick={() => {
                  setSaveOpen((v) => !v);
                  setSaveError(null);
                  setSaveNotice(null);
                }}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border border-[color:var(--border)] bg-bg-card text-[12px] text-[color:var(--text)] hover:bg-[color:var(--bg-hover)] transition-colors"
              >
                <BookmarkPlus className="size-3.5" strokeWidth={1.75} aria-hidden />
                현재 내용 저장
              </button>
            </div>

            <select
              id="seminar-template"
              value={templateId}
              onChange={(e) => onPickTemplate(e.target.value)}
              disabled={templateList.length === 0}
              className="w-full h-10 rounded-md px-2 bg-bg-card border border-[color:var(--border)] text-[14px] text-[color:var(--text)] focus:outline-none focus:border-[color:var(--border-strong)] cursor-pointer disabled:cursor-not-allowed disabled:text-[color:var(--text-dim)]"
            >
              <option value="">
                {templateList.length === 0
                  ? "저장된 상용문구가 없습니다"
                  : "— 새로 작성 —"}
              </option>
              {templateList.map((t) => (
                <option key={t.id} value={t.id}>
                  [{t.type}] {t.name}
                </option>
              ))}
            </select>

            {saveOpen && (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSaveTemplate();
                    }
                  }}
                  placeholder="문구 이름 (예: 겨울 설명회 안내)"
                  maxLength={40}
                  autoFocus
                  className="flex-1 h-10 rounded-md px-2 bg-bg-card border border-[color:var(--border)] text-[14px] text-[color:var(--text)] placeholder:text-[color:var(--text-dim)] focus:outline-none focus:border-[color:var(--border-strong)]"
                />
                <button
                  type="button"
                  onClick={handleSaveTemplate}
                  disabled={isSaving}
                  className="inline-flex items-center h-10 px-3 rounded-md bg-[color:var(--action)] text-[color:var(--action-text)] text-[13px] font-medium hover:bg-[color:var(--action-hover)] disabled:opacity-50 transition-colors"
                >
                  {isSaving ? "저장 중..." : "저장"}
                </button>
              </div>
            )}

            {saveError && (
              <p role="alert" className="text-[12px] text-[color:var(--danger)]">
                {saveError}
              </p>
            )}
            {saveNotice && (
              <p role="status" className="text-[12px] text-[color:var(--text-muted)]">
                {saveNotice}
              </p>
            )}
          </div>
        </div>

        {/* 테스트 발송 — 유형·광고성과 한 줄 오른쪽 */}
        <TestSendCard
          type={state.type}
          subject={state.subject}
          body={state.body.trim().length === 0 ? "" : state.body}
          isAd={state.isAd}
          senderDivision={senderDivision}
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
                onClick={() => insertToken("{초대링크}")}
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
              <button
                type="button"
                onClick={() => insertToken("{날짜}")}
                className="
                  inline-flex items-center justify-center h-8 px-3 rounded-full
                  border border-[color:var(--border)] bg-bg-card
                  text-[12px] text-[color:var(--text)]
                  hover:bg-[color:var(--bg-hover)]
                  focus:outline-none focus:ring-2 focus:ring-[color:var(--border-strong)]
                  transition-colors
                "
                aria-label="날짜 변수 삽입"
              >
                {"{날짜}"}
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
