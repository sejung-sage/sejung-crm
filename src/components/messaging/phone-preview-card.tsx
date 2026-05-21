"use client";

import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import type { TemplateTypeLiteral } from "@/lib/schemas/template";

/**
 * 핸드폰(iOS 메시지 앱 풍) 미리보기 카드.
 *
 * Batch D · #21~#23 의 공용 컴포넌트.
 *
 * - 운영자가 수신자 입장에서 가늠 가능하도록 좌측 정렬 회색 말풍선으로 렌더.
 * - 광고 캠페인이면 footer 자리에 별도 말풍선으로 학원명·080 수신거부 안내.
 * - `editable` 이면 제목/본문이 inline textarea/input 로 바뀌어 좌측 폼과
 *   같은 state 를 공유 — 어느 쪽을 편집해도 즉시 양방향 반영된다.
 *
 * 디자인 톤:
 *   - 흰+검정 미니멀, iOS 의 형광 컬러 배제 — 회색 톤 말풍선
 *   - 카드 외곽: rounded-3xl + 얇은 border + soft shadow
 *   - 폰트 15px (40~60대 운영팀 가독성)
 *
 * 광고 푸터(footer):
 *   - "(광고)" prefix 는 본문 말풍선 앞에 자동 삽입 (편집 불가 · 법령 강제)
 *   - 학원명 / 080 번호는 사용자가 편집 가능. 단 sendon 정책상 080 은
 *     발송 시 공식 번호로 치환될 수 있음을 안내.
 */

export interface PhonePreviewCardProps {
  /** SMS / LMS — 헤더 배지로 노출. */
  type: TemplateTypeLiteral;
  /** LMS 일 때만 노출되는 굵은 제목. SMS 면 빈 문자열 또는 null. */
  subject: string | null;
  /** 광고 prefix/suffix 가 이미 적용된 최종 본문. */
  body: string;
  /** 광고 캠페인 여부 — footer 말풍선 노출 여부. */
  isAd: boolean;
  /** 최종 바이트(광고 가드 적용 후). */
  rawBytes: number;
  /** 한도 초과 여부. */
  rawOverflow: boolean;
  /** 현재 type 의 한도(SMS 90, LMS 2000). */
  limit: number;

  /**
   * inline 편집 활성화.
   * true 면 subject / body 가 input · textarea 로 바뀌고 onChange 콜백 호출.
   * false (기본) 면 read-only 텍스트로 표시 (compose 3단계 미리보기 등).
   */
  editable?: boolean;
  /**
   * editable=true 이면서 LMS 일 때 호출. SMS 는 제목이 없으므로 무시.
   */
  onSubjectChange?: (next: string) => void;
  /**
   * editable=true 일 때 본문 변경 시 호출.
   *
   * 주의: 여기서 받는 값은 "사용자가 직접 입력한 본문" — 즉 광고 가드
   * (광고/080 등) 가 제거된 원본이어야 한다. 부모는 광고 prefix/suffix 시뮬을
   * 빼고 raw body 만 state 에 저장하므로, props.body 에 광고 prefix 가 포함된
   * 경우 textarea 의 value 는 원본만 노출해야 한다 → 부모가 `body` 대신
   * `rawBody` 를 함께 넘기지 않으면 안전하지 않다. 그래서 editable=true 일
   * 때는 부모가 `body` 에 **원본 본문** 을 넘겨주는 계약이다.
   */
  onBodyChange?: (next: string) => void;

  /**
   * 광고 footer 표시 정보. isAd 일 때만 사용.
   * editable=true 면 footer 자리도 input 으로 바뀐다.
   */
  footer?: {
    academyName: string;
    unsubscribePhone: string;
    onAcademyNameChange?: (next: string) => void;
    onUnsubscribePhoneChange?: (next: string) => void;
  };

  /** 헤더 시각 — 기본은 현재 KST 의 HH:mm. SSR/Hydration 안정성을 위해 부모가 넘김. */
  timeLabel?: string;
}

export function PhonePreviewCard({
  type,
  subject,
  body,
  isAd,
  rawBytes,
  rawOverflow,
  limit,
  editable = false,
  onSubjectChange,
  onBodyChange,
  footer,
  timeLabel,
}: PhonePreviewCardProps) {
  // 부모가 timeLabel 을 안 줬다면 현재 KST 시각.
  // SSR 에서는 빈 문자열 → 클라이언트 hydrate 시 useMemo 가 한 번 계산.
  const time = useMemo(() => {
    if (timeLabel !== undefined) return timeLabel;
    try {
      const now = new Date();
      const hh = now.getHours().toString().padStart(2, "0");
      const mm = now.getMinutes().toString().padStart(2, "0");
      return `${hh}:${mm}`;
    } catch {
      return "";
    }
  }, [timeLabel]);

  const subjectVisible = type === "LMS";

  return (
    <section
      aria-label="문자 미리보기"
      className="
        rounded-3xl border border-[color:var(--border-strong)]
        bg-bg-card shadow-sm overflow-hidden
      "
    >
      {/* ── 폰 상단 헤더 ─────────────────────────────────── */}
      <header
        className="
          flex items-center justify-between gap-3
          px-5 py-3 border-b border-[color:var(--border-strong)]
          bg-[color:var(--bg-muted)]
        "
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            aria-hidden
            className="
              inline-flex items-center justify-center
              size-8 rounded-full
              bg-[color:var(--action)] text-[color:var(--action-text)]
              text-[12px] font-semibold
            "
          >
            세정
          </span>
          <div className="flex flex-col min-w-0">
            <span className="text-[14px] font-semibold text-[color:var(--text)] truncate">
              세정학원
            </span>
            <span className="text-[11px] text-[color:var(--text-muted)] tabular-nums">
              {type}
              {isAd && <span className="ml-1.5">· 광고</span>}
            </span>
          </div>
        </div>
        <span
          className="text-[12px] text-[color:var(--text-muted)] tabular-nums shrink-0"
          aria-label={`현재 시각 ${time}`}
        >
          {time}
        </span>
      </header>

      {/* ── 말풍선 영역 ───────────────────────────────── */}
      <div className="px-4 py-5 space-y-3 bg-bg-card min-h-[280px]">
        {/* 본문 말풍선 — 좌측 정렬 */}
        <div className="flex justify-start">
          <div
            className="
              max-w-[85%] rounded-2xl rounded-tl-md
              bg-[color:var(--bg-muted)]
              px-4 py-3 space-y-2
            "
          >
            {subjectVisible && (
              <SubjectField
                value={subject ?? ""}
                editable={editable}
                onChange={onSubjectChange}
              />
            )}
            <BodyField
              value={body}
              editable={editable}
              onChange={onBodyChange}
            />
          </div>
        </div>

        {/* 광고 footer — 별도 말풍선 */}
        {isAd && footer && (
          <div className="flex justify-start">
            <div
              className="
                max-w-[85%] rounded-2xl rounded-tl-md
                bg-[color:var(--bg-muted)]
                px-4 py-2.5 space-y-1
              "
            >
              <FooterField
                academyName={footer.academyName}
                unsubscribePhone={footer.unsubscribePhone}
                editable={editable}
                onAcademyNameChange={footer.onAcademyNameChange}
                onUnsubscribePhoneChange={footer.onUnsubscribePhoneChange}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── 메타 (바이트 / 한도) ─────────────────────── */}
      <footer
        className="
          px-5 py-3 border-t border-[color:var(--border-strong)]
          bg-[color:var(--bg-muted)]
          flex items-center justify-between gap-3
        "
      >
        <span className="text-[12px] text-[color:var(--text-muted)]">
          최종 바이트
        </span>
        <span
          className={`text-[13px] tabular-nums ${
            rawOverflow
              ? "text-[color:var(--danger)] font-medium"
              : "text-[color:var(--text)]"
          }`}
          aria-live="polite"
        >
          {rawBytes.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </footer>

      {rawOverflow && (
        <p
          role="alert"
          className="
            flex items-start gap-1.5
            px-5 py-2 text-[12px] leading-relaxed
            text-[color:var(--danger)]
            border-t border-[color:var(--border-strong)]
            bg-[color:var(--danger-bg)]
          "
        >
          <AlertTriangle
            className="size-3.5 mt-0.5 shrink-0"
            strokeWidth={1.75}
            aria-hidden
          />
          광고 머리말·꼬리까지 합치면 {type} 한도를 넘습니다. LMS 로 바꾸거나
          본문을 줄여주세요.
        </p>
      )}
    </section>
  );
}

// ─── 내부 컴포넌트 ───────────────────────────────────────

function SubjectField({
  value,
  editable,
  onChange,
}: {
  value: string;
  editable: boolean;
  onChange?: (next: string) => void;
}) {
  if (editable && onChange) {
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="제목을 입력하세요"
        maxLength={40}
        aria-label="미리보기 제목 편집"
        className="
          block w-full bg-transparent
          text-[15px] font-semibold text-[color:var(--text)]
          leading-tight
          placeholder:text-[color:var(--text-dim)]
          focus:outline-none focus:ring-2 focus:ring-[color:var(--border-strong)]
          rounded-sm px-1 -mx-1
        "
      />
    );
  }
  if (!value) return null;
  return (
    <p className="text-[15px] font-semibold text-[color:var(--text)] leading-tight">
      {value}
    </p>
  );
}

function BodyField({
  value,
  editable,
  onChange,
}: {
  value: string;
  editable: boolean;
  onChange?: (next: string) => void;
}) {
  if (editable && onChange) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="문자 본문을 입력하세요."
        rows={Math.max(4, value.split("\n").length + 1)}
        aria-label="미리보기 본문 편집"
        className="
          block w-full bg-transparent resize-none
          text-[15px] leading-relaxed text-[color:var(--text)]
          placeholder:text-[color:var(--text-dim)]
          focus:outline-none focus:ring-2 focus:ring-[color:var(--border-strong)]
          rounded-sm px-1 -mx-1
        "
        style={{ fontFamily: "var(--font-sans)" }}
      />
    );
  }
  return (
    <pre
      className="
        whitespace-pre-wrap break-words
        text-[15px] leading-relaxed text-[color:var(--text)]
        font-sans
      "
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {value || (
        <span className="text-[color:var(--text-dim)]">
          본문을 입력하면 여기에 표시됩니다.
        </span>
      )}
    </pre>
  );
}

function FooterField({
  academyName,
  unsubscribePhone,
  editable,
  onAcademyNameChange,
  onUnsubscribePhoneChange,
}: {
  academyName: string;
  unsubscribePhone: string;
  editable: boolean;
  onAcademyNameChange?: (next: string) => void;
  onUnsubscribePhoneChange?: (next: string) => void;
}) {
  if (editable && onAcademyNameChange && onUnsubscribePhoneChange) {
    return (
      <div className="space-y-0.5">
        <input
          type="text"
          value={academyName}
          onChange={(e) => onAcademyNameChange(e.target.value)}
          aria-label="발신 학원명 편집"
          placeholder="세정학원"
          maxLength={20}
          className="
            block w-full bg-transparent
            text-[13px] text-[color:var(--text-muted)]
            placeholder:text-[color:var(--text-dim)]
            focus:outline-none focus:ring-2 focus:ring-[color:var(--border-strong)]
            rounded-sm px-1 -mx-1
          "
        />
        <input
          type="text"
          value={unsubscribePhone}
          onChange={(e) => onUnsubscribePhoneChange(e.target.value)}
          aria-label="수신거부 번호 편집"
          placeholder="080-XXX-XXXX"
          maxLength={20}
          className="
            block w-full bg-transparent
            text-[13px] text-[color:var(--text-muted)] tabular-nums
            placeholder:text-[color:var(--text-dim)]
            focus:outline-none focus:ring-2 focus:ring-[color:var(--border-strong)]
            rounded-sm px-1 -mx-1
          "
        />
      </div>
    );
  }
  return (
    <div className="text-[13px] text-[color:var(--text-muted)] leading-relaxed">
      <div>{academyName}</div>
      <div className="tabular-nums">무료수신거부 {unsubscribePhone}</div>
    </div>
  );
}
