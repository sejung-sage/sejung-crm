"use client";

import { useMemo, useRef } from "react";
import { AlertTriangle, Link as LinkIcon } from "lucide-react";
import type { SeminarListItem, GroupListItem } from "@/types/database";
import { countEucKrBytes } from "@/lib/messaging/sms-bytes";
import { formatKstDateTime } from "@/lib/datetime";
import type { SeminarComposeState, SmsType } from "./seminar-compose-wizard";

/**
 * F5 · 설명회 발송 Step 3 — 본문 작성.
 *
 * 특징:
 *  - 변수 토큰 `{초대링크}` 안내. 본문에 없으면 발송 시점에 자동 부착(서버).
 *  - 학생별 URL 평균 길이 ~250바이트 가정 → 안전 한도 1,750바이트 표기.
 *  - 미리보기 박스에 예시 학생 URL 치환 결과 노출.
 *
 * 좌: 작성 패널 (type / subject / body)
 * 우: 미리보기 카드
 */

interface Props {
  state: SeminarComposeState;
  onChange: (patch: Partial<SeminarComposeState>) => void;
  selectedSeminars: SeminarListItem[];
  selectedGroup: GroupListItem | null;
}

/** URL 자리 예상 — sendon 단축 URL 미사용 가정. 학생별 토큰 12자 + origin. */
const URL_RESERVED_BYTES = 250;
const LMS_BYTE_LIMIT = 2000;
const SMS_BYTE_LIMIT = 90;

export function SeminarComposeStep3Body({
  state,
  onChange,
  selectedSeminars,
  selectedGroup,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // 본문 바이트 (변수 미치환 상태).
  const bodyBytes = useMemo(() => countEucKrBytes(state.body), [state.body]);
  const limit = state.type === "LMS" ? LMS_BYTE_LIMIT : SMS_BYTE_LIMIT;
  const safeLimit = limit - URL_RESERVED_BYTES;
  // {초대링크} 가 본문에 이미 있으면 URL 예약 바이트만 사용. 없으면 자동 부착 가정.
  const hasInviteVar = state.body.includes("{초대링크}");
  const isOverLimit = bodyBytes > safeLimit;

  const preview = useMemo(() => buildPreview(state.body, selectedSeminars), [
    state.body,
    selectedSeminars,
  ]);

  const handleInsertInviteVar = () => {
    const el = textareaRef.current;
    if (!el) {
      onChange({ body: `${state.body}\n신청하기: {초대링크}` });
      return;
    }
    const start = el.selectionStart ?? state.body.length;
    const end = el.selectionEnd ?? state.body.length;
    const before = state.body.slice(0, start);
    const after = state.body.slice(end);
    const next = `${before}{초대링크}${after}`;
    onChange({ body: next });
    // 커서를 변수 뒤로.
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + "{초대링크}".length;
      el.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
          본문 작성
        </h2>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          학생별 신청 URL 은 본문의 <code className="text-[12px]">{`{초대링크}`}</code>
          {" "}자리에 자동 치환됩니다. 변수가 없으면 본문 끝에 자동 부착됩니다.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 좌: 작성 패널 */}
        <div className="space-y-4">
          {/* 유형 */}
          <div className="space-y-1.5">
            <span className="text-[14px] font-medium text-[color:var(--text)]">
              유형
            </span>
            <div className="flex items-center gap-2">
              <TypeRadio
                value="LMS"
                current={state.type}
                onChange={(t) =>
                  onChange({
                    type: t,
                    // LMS → SMS 전환 시 subject 는 무시되지만 보존.
                  })
                }
                label="LMS (장문)"
              />
              <TypeRadio
                value="SMS"
                current={state.type}
                onChange={(t) => onChange({ type: t })}
                label="SMS (단문)"
              />
            </div>
            <p className="text-[12px] text-[color:var(--text-dim)]">
              설명회 안내는 일반적으로 본문이 길어 LMS 가 기본입니다.
            </p>
          </div>

          {/* 제목 (LMS) */}
          {state.type === "LMS" && (
            <div className="space-y-1.5">
              <label
                htmlFor="seminar-subject"
                className="text-[14px] font-medium text-[color:var(--text)]"
              >
                제목
              </label>
              <input
                id="seminar-subject"
                type="text"
                value={state.subject ?? ""}
                onChange={(e) => onChange({ subject: e.target.value })}
                maxLength={120}
                placeholder="예: 설명회 안내"
                className="
                  w-full h-10 px-3 rounded-lg
                  bg-bg-card border border-[color:var(--border)]
                  text-[15px] text-[color:var(--text)]
                  placeholder:text-[color:var(--text-dim)]
                  focus:outline-none focus:border-[color:var(--border-strong)]
                "
              />
            </div>
          )}

          {/* 본문 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="seminar-body"
                className="text-[14px] font-medium text-[color:var(--text)]"
              >
                본문
              </label>
              <button
                type="button"
                onClick={handleInsertInviteVar}
                className="
                  inline-flex items-center gap-1 h-7 px-2 rounded-md
                  border border-[color:var(--border)] bg-bg-card
                  text-[12px] text-[color:var(--text-muted)]
                  hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text)]
                  transition-colors
                "
              >
                <LinkIcon className="size-3.5" strokeWidth={1.75} aria-hidden />
                초대링크 변수 삽입
              </button>
            </div>
            <textarea
              id="seminar-body"
              ref={textareaRef}
              value={state.body}
              onChange={(e) => onChange({ body: e.target.value })}
              rows={10}
              placeholder={"[설명회 안내]\n2026 여름방학 고1 설명회\n6/8 (월) 10:30 · 우전관 2층\n\n신청하기: {초대링크}"}
              className="
                w-full px-3 py-2 rounded-lg
                bg-bg-card border border-[color:var(--border)]
                text-[15px] text-[color:var(--text)] font-mono
                placeholder:text-[color:var(--text-dim)] placeholder:font-sans
                focus:outline-none focus:border-[color:var(--border-strong)]
                resize-y
              "
            />

            {/* 바이트 진행 */}
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-[color:var(--text-muted)] tabular-nums">
                본문 {bodyBytes}바이트 · 한도 {safeLimit}바이트 (URL 자리 {URL_RESERVED_BYTES}바이트 제외)
              </span>
              {!hasInviteVar && (
                <span className="text-[color:var(--text-dim)]">
                  변수 없음 → 끝에 자동 부착됨
                </span>
              )}
            </div>

            {isOverLimit && (
              <div
                role="alert"
                className="flex items-center gap-1.5 text-[13px] text-[color:var(--danger)]"
              >
                <AlertTriangle
                  className="size-4 shrink-0"
                  strokeWidth={1.75}
                  aria-hidden
                />
                본문이 {state.type} 한도를 초과합니다. 글자 수를 줄이거나{" "}
                {state.type === "SMS" ? "LMS 로 전환하세요." : "내용을 줄여주세요."}
              </div>
            )}
          </div>
        </div>

        {/* 우: 미리보기 */}
        <div className="space-y-3">
          <div className="text-[12px] font-medium uppercase tracking-wider text-[color:var(--text-dim)]">
            미리보기
          </div>
          <div
            aria-label="발송 미리보기"
            className="
              rounded-2xl border border-[color:var(--border-strong)] bg-[color:var(--bg-muted)] p-4
              text-[14px] leading-relaxed text-[color:var(--text)]
              whitespace-pre-wrap break-words font-mono
              min-h-[280px]
            "
          >
            {preview}
          </div>
          <p className="text-[11px] text-[color:var(--text-dim)] leading-relaxed">
            실제 발송 시 <code>{`{초대링크}`}</code> 는 학생별
            <code className="ml-1">https://·/s/&lt;토큰&gt;</code> URL 로 치환됩니다.
            {selectedGroup && (
              <>
                {" "}대상: <strong className="text-[color:var(--text-muted)]">{selectedGroup.name}</strong>
                {" "}· 약 {selectedGroup.recipient_count.toLocaleString()}명.
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── 미리보기 빌더 ──────────────────────────────────────────

function buildPreview(body: string, seminars: SeminarListItem[]): string {
  const primary = seminars[0] ?? null;
  // 예시 학생: "김민준" / 가상 토큰.
  // {초대링크} 변수가 없으면 끝에 자동 부착하는 backend 동작을 시각적으로 미리 보임.
  const exampleUrl = "https://crm.example.com/s/abcd1234efgh";
  let next = body.replace(/\{초대링크\}/g, exampleUrl);
  if (!body.includes("{초대링크}") && next.trim().length > 0) {
    next = `${next}\n신청하기: ${exampleUrl}`;
  }
  // {이름} {날짜} 같은 일반 변수도 친절히 치환(예시).
  next = next.replace(/\{이름\}/g, "김민준");
  if (primary?.held_at) {
    next = next.replace(/\{날짜\}/g, formatKstDateTime(primary.held_at));
  }
  return next || "본문을 입력하면 미리보기가 여기에 표시됩니다.";
}

// ─── 작은 컴포넌트 ──────────────────────────────────────────

function TypeRadio({
  value,
  current,
  onChange,
  label,
}: {
  value: SmsType;
  current: SmsType;
  onChange: (v: SmsType) => void;
  label: string;
}) {
  const active = value === current;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      aria-pressed={active}
      className={`
        inline-flex items-center gap-1.5 h-9 px-3 rounded-lg
        text-[13px] font-medium border
        transition-colors
        ${active
          ? "bg-[color:var(--action)] text-[color:var(--action-text)] border-[color:var(--action)]"
          : "bg-bg-card text-[color:var(--text-muted)] border-[color:var(--border)] hover:bg-[color:var(--bg-hover)]"}
      `}
    >
      {label}
    </button>
  );
}
