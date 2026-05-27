"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AlertTriangle, Loader2, Megaphone, Moon, Users } from "lucide-react";
import type { GroupListItem, TemplateRow } from "@/types/database";
import type { PreviewResult } from "@/lib/messaging/preview-recipients";
import { previewAction } from "@/app/(features)/compose/actions";
import { PhonePreviewCard } from "@/components/messaging/phone-preview-card";
import { TestSendCard } from "@/components/messaging/test-send-card";
import { BYTE_LIMITS, type TemplateTypeLiteral } from "@/lib/schemas/template";
import { countEucKrBytes } from "@/lib/messaging/sms-bytes";
import {
  insertAdTag,
  insertUnsubscribeFooter,
} from "@/lib/messaging/guards";
import { hasNameToken } from "@/lib/messaging/personalize";
import type { ComposeStep2State } from "./compose-wizard";
import { DedupeCountNote, extractDedupeCounts } from "./dedupe-count-note";

/**
 * F3 Part B · Step 2 — 작성 + 미리보기 통합.
 *
 * 2026-05-26 개편: "미리보기에 직접 타자" UX.
 *   - 본문/제목 textarea·input 을 좌측 폼에서 제거. PhonePreviewCard editable
 *     모드의 input 으로 일원화 → 운영자가 미리보기 말풍선에서 바로 타이핑.
 *   - 본문 변경은 서버 호출 트리거 X. 광고 prefix·080 footer·바이트 카운트는
 *     모두 클라이언트에서 instant 계산 (guards 가 순수 함수).
 *   - 서버 previewAction 은 groupId / type / isAd 가 바뀔 때만 호출 — 수신자
 *     카운트·비용·sample·blockedByQuietHours 갱신용.
 *   - 변수 삽입 [{이름}] [{날짜}] 는 미리보기 textarea 의 ref 로 cursor 위치에 삽입.
 *
 * 좌측: 템플릿 picker / 유형 / 광고 토글 / 변수 삽입 / 안내·경고
 * 우측: 핸드폰 미리보기 카드(editable) — sticky
 *
 * 가드 최종 검증은 server 가 sendCampaign 단계에서 한 번 더 적용.
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
  /**
   * 예약 발송 시각(ISO local input string `YYYY-MM-DDTHH:mm`). null 이면 즉시 발송.
   * sample 미리보기의 `{날짜}` 치환 기준값으로 사용 — 예약이면 예약일, 즉시면 오늘.
   */
  scheduleAt: string | null;
  /** 서버 env SMS_OPT_OUT_NUMBER. footer 정적 렌더에 사용. */
  optOutNumber: string;
}

// LMS 제목 한도 — EUC-KR 40byte (한글 20자, 영문 40자). 사용자 정책 2026-05-22.
const SUBJECT_BYTE_LIMIT = 40;

const TYPE_OPTIONS: Array<{
  value: TemplateTypeLiteral;
  label: string;
  hint: string;
}> = [
  { value: "SMS", label: "SMS · 단문", hint: "90바이트" },
  { value: "LMS", label: "LMS · 장문", hint: "2000바이트" },
];

// 본문 textarea 에 삽입 가능한 변수 토큰. {선생}/{강좌} 는 학생당 다수라 모호 → 제외.
const VARIABLE_TOKENS: Array<{ token: string; label: string }> = [
  { token: "{이름}", label: "{이름}" },
  { token: "{날짜}", label: "{날짜}" },
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
  scheduleAt,
  optOutNumber,
}: Props) {
  const [loading, startLoading] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // 제목 byte (LMS 만 표시).
  const subjectBytes = useMemo(
    () => (step2.subject ? countEucKrBytes(step2.subject) : 0),
    [step2.subject],
  );
  const subjectOverflow = subjectBytes > SUBJECT_BYTE_LIMIT;

  // 본문 byte — 클라이언트에서 광고 prefix + 080 footer 합산해 즉시 계산.
  // 서버 결과 도착 전에도 정확. (서버 fallback 불필요 — guards 가 순수 함수)
  const clientFinalBody = useMemo(() => {
    const withAd = insertAdTag(step2.body, step2.isAd);
    return insertUnsubscribeFooter(withAd, step2.isAd, optOutNumber);
  }, [step2.body, step2.isAd, optOutNumber]);
  const finalBodyBytes = useMemo(
    () => countEucKrBytes(clientFinalBody),
    [clientFinalBody],
  );
  const bodyLimit = BYTE_LIMITS[step2.type];
  const bodyOverflow = finalBodyBytes > bodyLimit;

  // 본문에 {이름} 토큰이 있으면 동일번호 1회 발송과 상호배타(서버 Zod refine 이 최종 강제).
  // UI 는 토글을 비활성/경고하고, 토큰 삽입 시 켜져 있던 dedupe 를 자동으로 끈다.
  const bodyHasNameToken = useMemo(
    () => hasNameToken(step2.body),
    [step2.body],
  );

  // backend 가 PreviewResult.dedupe(DedupeCounts) 를 내려주면 인원 표기에 사용.
  // 아직 없으면 null → 종전 단일 인원 표기 유지.
  const dedupeCounts = useMemo(
    () => extractDedupeCounts(preview),
    [preview],
  );

  // sample 변수 치환에 쓸 값.
  // 이름: preview 의 sampleRecipients[0]. 없으면 fallback.
  // 날짜: scheduleAt 있으면 그 날짜, 없으면 오늘 KST. M월 D일 형식.
  const sampleValues = useMemo(() => {
    const name = preview?.sampleRecipients?.[0]?.name ?? "학생";
    const date = formatKstDateLabel(scheduleAt);
    return { name, date };
  }, [preview, scheduleAt]);

  // 개인화({이름}) 가 본문에 들어오면 dedupe 자동 해제(상호배타).
  // 변수 삽입 버튼·미리보기 직접 타이핑 어느 경로로 들어와도 일관 처리.
  useEffect(() => {
    if (bodyHasNameToken && step2.dedupeByPhone) {
      onStep2Change({ ...step2, dedupeByPhone: false });
    }
    // step2/onStep2Change 는 매 렌더 새 참조 — bodyHasNameToken 변화에만 반응.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyHasNameToken]);

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
      // 템플릿 선택 시 동일번호 1회 발송은 초기화(false).
      dedupeByPhone: false,
    });
  };

  /**
   * 변수 토큰을 미리보기 본문 textarea 의 cursor 위치에 삽입.
   * focus 가 textarea 가 아니거나 처음 사용 시에는 끝에 append.
   */
  const insertToken = (token: string) => {
    const ta = bodyRef.current;
    const current = step2.body;
    if (!ta) {
      onStep2Change({ ...step2, body: current + token });
      return;
    }
    const start = ta.selectionStart ?? current.length;
    const end = ta.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    onStep2Change({ ...step2, body: next });
    requestAnimationFrame(() => {
      const node = bodyRef.current;
      if (!node) return;
      const cursor = start + token.length;
      node.focus();
      node.setSelectionRange(cursor, cursor);
    });
  };

  // 서버 미리보기는 본문/제목 변경에는 트리거 X. groupId/type/isAd/dedupe 가 바뀔 때만.
  //   - recipientCount: groupId 만 영향
  //   - cost: groupId × type × dedupe(actualMessages 기준 비용)
  //   - blockedByQuietHours: isAd × 현재 시각
  //   - sampleRecipients: groupId 만 영향
  //   - dedupe(DedupeCounts): groupId × dedupeByPhone
  // body/subject 변경은 클라이언트에서 즉시 반영 → 서버 호출 불필요.
  useEffect(() => {
    setErrorMsg(null);
    startLoading(async () => {
      const result = await previewAction({
        groupId,
        step2: {
          templateId: step2.templateId,
          type: step2.type,
          subject: step2.subject,
          // 서버에는 가드 적용 후 body 를 넘겨주되, 어차피 server 가 재가공함.
          // body 변경에는 트리거 안 하므로 직전 step2.body 가 들어감 — 무방.
          body: step2.body,
          isAd: step2.isAd,
          dedupeByPhone: step2.dedupeByPhone,
        },
      });
      if (result.status === "success") {
        onPreview(result.data);
      } else {
        setErrorMsg(result.reason);
        onPreview(null);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, step2.isAd, step2.type, step2.dedupeByPhone]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
          발송 미리보기
        </h2>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          오른쪽 미리보기 말풍선에서 바로 제목·본문을 작성하세요. 광고
          머리말·080 수신거부는 자동으로 붙습니다.
        </p>
      </div>

      {/* 테스트 발송 카드 */}
      <TestSendCard
        type={step2.type}
        subject={step2.subject ?? null}
        body={step2.body}
        isAd={step2.isAd}
        disabled={!step2.body.trim() || loading}
      />

      {loading && !preview && (
        <div className="flex items-center gap-2 text-[14px] text-[color:var(--text-muted)]">
          <Loader2
            className="size-4 animate-spin"
            strokeWidth={1.75}
            aria-hidden
          />
          수신자 정보를 계산하는 중...
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

      {preview && preview.recipientCount === 0 && !loading && (
        <div
          role="alert"
          className="rounded-lg border border-[color:var(--warning)] bg-[color:var(--warning-bg)] px-4 py-3 text-[13px] text-[color:var(--text)]"
        >
          발송 가능한 수신자가 없습니다. 그룹 조건을 다시 확인해 주세요.
        </div>
      )}

      {/* 2 column — 좌: 메타 컨트롤 / 우: editable 미리보기(sticky) */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px] gap-6 items-start">
        {/* 좌측 — 메타 컨트롤 */}
        <div className="space-y-4 min-w-0">
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

          {/* 제목 byte 카운트 (LMS) — 입력은 미리보기에서 함. 좌측엔 카운터만. */}
          {step2.type !== "SMS" && (
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
              {VARIABLE_TOKENS.map((v) => (
                <button
                  key={v.token}
                  type="button"
                  onClick={() => insertToken(v.token)}
                  className="
                    inline-flex items-center justify-center
                    h-8 px-3 rounded-full
                    border border-[color:var(--border)]
                    bg-bg-card text-[12px] text-[color:var(--text)]
                    hover:bg-[color:var(--bg-hover)]
                    focus:outline-none focus:ring-2 focus:ring-[color:var(--border-strong)]
                    transition-colors
                  "
                  style={{
                    fontFamily:
                      "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
                  }}
                  aria-label={`${v.label} 삽입`}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[color:var(--text-dim)]">
              발송 시 각 수신자 정보로 자동 치환됩니다. 예시 1명 기준 치환
              결과는 미리보기 아래에 따로 표시됩니다.
            </p>
          </div>

          {/* 광고 체크 */}
          <label className="flex items-start gap-2 cursor-pointer pt-1">
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

          {/* 동일번호 1회 발송 — isAd 와 동일 형태/톤의 발송 옵션 토글.
              본문에 {이름} 변수가 있으면 비활성(개인화 상호배타). */}
          <label
            className={`flex items-start gap-2 pt-1 ${
              bodyHasNameToken ? "cursor-not-allowed" : "cursor-pointer"
            }`}
          >
            <input
              type="checkbox"
              checked={step2.dedupeByPhone}
              disabled={bodyHasNameToken}
              onChange={(e) =>
                onStep2Change({ ...step2, dedupeByPhone: e.target.checked })
              }
              className="mt-0.5 size-4 accent-[color:var(--action)] disabled:cursor-not-allowed"
            />
            <span className="flex flex-col gap-0.5">
              <span
                className={`text-[13px] font-medium ${
                  bodyHasNameToken
                    ? "text-[color:var(--text-dim)]"
                    : "text-[color:var(--text)]"
                }`}
              >
                동일번호 1회 발송
              </span>
              <span className="text-[11px] text-[color:var(--text-muted)]">
                형제 등 같은 번호는 한 번만 보내 문자비를 아낍니다.
              </span>
            </span>
          </label>

          {bodyHasNameToken && (
            <div
              role="note"
              className="flex items-start gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-3 py-2"
            >
              <Users
                className="size-3.5 mt-0.5 text-[color:var(--text-muted)] shrink-0"
                strokeWidth={1.75}
                aria-hidden
              />
              <p className="text-[12px] leading-relaxed text-[color:var(--text-muted)]">
                {"{이름}"} 변수를 쓰면 같은 번호도 각각 보내야 해서 동일번호 1회
                발송을 사용할 수 없어요.
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
        </div>

        {/* 우측 — editable 미리보기 (sticky) */}
        <aside className="space-y-2 lg:sticky lg:top-4 self-start">
          <PhonePreviewCard
            type={step2.type}
            subject={step2.subject}
            body={step2.body}
            isAd={step2.isAd}
            rawBytes={finalBodyBytes}
            rawOverflow={bodyOverflow}
            limit={bodyLimit}
            editable
            onSubjectChange={(next) =>
              onStep2Change({ ...step2, subject: next })
            }
            onBodyChange={(next) => onStep2Change({ ...step2, body: next })}
            bodyTextareaRef={bodyRef}
            footer={
              step2.isAd
                ? {
                    academyName: "세정학원",
                    unsubscribePhone: optOutNumber,
                  }
                : undefined
            }
            samples={sampleValues}
            recipientCount={preview?.recipientCount}
          />
          <p className="text-[11px] text-[color:var(--text-dim)] px-1">
            광고 머리말·080 수신거부는 자동 적용된 결과로 표시됩니다. 본문
            바이트도 그 가공 결과 기준이에요.
          </p>
        </aside>
      </div>

      {/* 비용 카드 + 캠페인 제목 — preview 있을 때만. */}
      {preview && !loading && (
        <div className="space-y-4">
          {/* 동일번호 1회 발송이 적용돼 실제 합쳐진 건이 있으면 인원 안내. */}
          <DedupeCountNote counts={dedupeCounts} variant="card" />

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
        </div>
      )}
    </div>
  );
}

/**
 * scheduleAt 을 한국식 "M월 D일" 라벨로 변환.
 * 입력 형식: `YYYY-MM-DDTHH:mm` (datetime-local input) 또는 null.
 * null/유효 X → 오늘 KST.
 */
function formatKstDateLabel(scheduleAt: string | null): string {
  let target: Date;
  if (scheduleAt) {
    const parsed = new Date(scheduleAt);
    target = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  } else {
    target = new Date();
  }
  const kst = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
  }).format(target);
  return kst;
}
