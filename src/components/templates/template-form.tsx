"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, MessageSquare, Megaphone, Send } from "lucide-react";
import { BYTE_LIMITS, type TemplateTypeLiteral } from "@/lib/schemas/template";
import { byteProgress, countEucKrBytes } from "@/lib/messaging/sms-bytes";
import {
  createTemplateAction,
  updateTemplateAction,
} from "@/app/(features)/templates/actions";
import { testSendAction } from "@/app/(features)/compose/actions";
import { useToast } from "@/components/ui/toast";

/**
 * F3-01 · 템플릿 생성/수정 공용 폼.
 *
 * 0059 마이그 이후 변경점:
 *  - 유형 옵션: SMS / LMS 2종 (ALIMTALK 제거 — sendon.kakao + 사전 등록
 *    템플릿 ID 필요로 Phase 1 보류)
 *  - 강사명 필드 제거 (templates.teacher_name 컬럼 삭제)
 *  - 레이아웃: 2 컬럼 grid — 좌측 form, 우측 실시간 미리보기 panel
 *  - 미리보기는 광고 prefix `(광고)` / 080 수신거부 suffix 자동 시뮬레이션
 *    (실 발송 시 server 단 가드가 한 번 더 적용됨 — UI 는 결과 가늠용)
 *
 * 우측 미리보기 패널은 sticky — 본문이 길어져도 화면 안에 항상 보임.
 */
export interface TemplateFormInitial {
  name: string;
  subject: string | null;
  body: string;
  type: TemplateTypeLiteral;
  is_ad: boolean;
}

interface Props {
  mode: "create" | "edit";
  templateId?: string;
  initial: TemplateFormInitial;
}

const TYPE_OPTIONS: Array<{
  value: TemplateTypeLiteral;
  label: string;
  hint: string;
}> = [
  { value: "SMS", label: "SMS · 단문", hint: "90바이트" },
  { value: "LMS", label: "LMS · 장문", hint: "2000바이트" },
];

/** 광고성 발송 시 자동 삽입되는 머리말·꼬리. 실 발송 가드와 표기 일치. */
const AD_PREFIX = "(광고)";
const AD_SUFFIX = "\n무료수신거부 080-XXX-XXXX";

export function TemplateForm({ mode, templateId, initial }: Props) {
  const router = useRouter();
  const { show: showToast } = useToast();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState(initial.name);
  const [type, setType] = useState<TemplateTypeLiteral>(initial.type);
  const [subject, setSubject] = useState(initial.subject ?? "");
  const [body, setBody] = useState(initial.body);
  const [isAd, setIsAd] = useState(initial.is_ad);

  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const progress = useMemo(() => byteProgress(body, type), [body, type]);
  const overflow = progress.bytes > progress.limit;
  const subjectRequired = type === "LMS";

  /**
   * 미리보기 본문 — 광고 가드 시뮬레이션.
   * (광고) prefix 와 080 무료수신거부 suffix 를 본문 앞뒤에 자동 부착.
   * 실 발송 시 server 측에서 동일 가드가 한 번 더 적용된다.
   */
  const previewBody = useMemo(() => {
    if (!isAd) return body;
    const trimmedBody = body.trimEnd();
    return `${AD_PREFIX} ${trimmedBody}${AD_SUFFIX}`;
  }, [body, isAd]);

  const previewBytes = useMemo(
    () => countEucKrBytes(previewBody),
    [previewBody],
  );
  const previewOverflow = previewBytes > BYTE_LIMITS[type];

  const onTypeChange = (next: TemplateTypeLiteral) => {
    setType(next);
    if (next === "SMS") {
      setSubject(""); // SMS 는 제목 없음
    }
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "템플릿명은 필수입니다";
    if (name.trim().length > 40) errs.name = "템플릿명은 40자 이내";
    if (subjectRequired && !subject.trim()) {
      errs.subject = "LMS 는 제목이 필수입니다";
    }
    if (subject.trim().length > 40) {
      errs.subject = "제목은 40자 이내";
    }
    if (!body.trim()) errs.body = "본문은 필수입니다";
    if (overflow) errs.body = "바이트 한도를 초과했습니다";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setNotice(null);
    setErrorMsg(null);
    if (!validate()) return;

    startTransition(async () => {
      const payload = {
        name: name.trim(),
        type,
        subject: subjectRequired ? subject.trim() : null,
        body: body.trim(),
        is_ad: isAd,
      };

      if (mode === "create") {
        const result = await createTemplateAction(payload);
        if (result.status === "success") {
          showToast("success", `'${payload.name}' 템플릿을 만들었어요`);
          router.push("/templates");
          router.refresh();
        } else if (result.status === "dev_seed_mode") {
          setNotice(
            "개발용 시드 데이터라 실제 저장되지 않습니다. Supabase 연결 후 동작합니다.",
          );
        } else {
          setErrorMsg(result.reason);
          showToast("error", `템플릿 생성 실패: ${result.reason}`);
        }
      } else {
        if (!templateId) {
          setErrorMsg("템플릿 ID 가 없습니다");
          return;
        }
        const result = await updateTemplateAction({
          id: templateId,
          ...payload,
        });
        if (result.status === "success") {
          setNotice("저장되었습니다.");
          router.refresh();
        } else if (result.status === "dev_seed_mode") {
          setNotice(
            "개발용 시드 데이터라 실제 수정되지 않습니다. Supabase 연결 후 동작합니다.",
          );
        } else {
          setErrorMsg(result.reason);
        }
      }
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6"
      aria-busy={isPending}
    >
      {/* ─── 좌측 폼 ─────────────────────────────────────── */}
      <div className="space-y-6">
        {/* 안내·오류 */}
        {notice && (
          <div
            role="status"
            className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-4 py-2.5 text-[14px] text-[color:var(--text-muted)]"
          >
            {notice}
          </div>
        )}
        {errorMsg && (
          <div
            role="alert"
            className="rounded-lg border border-[color:var(--danger)] bg-[color:var(--danger-bg)] px-4 py-2.5 text-[14px] text-[color:var(--danger)]"
          >
            {errorMsg}
          </div>
        )}

        {/* 템플릿명 */}
        <div className="space-y-1.5">
          <label
            htmlFor="tpl-name"
            className="text-[14px] font-medium text-[color:var(--text)]"
          >
            템플릿명
          </label>
          <input
            id="tpl-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 주간테스트 안내"
            maxLength={60}
            className="
              w-full h-10 rounded-lg px-3
              bg-bg-card border border-[color:var(--border)]
              text-[15px] text-[color:var(--text)]
              placeholder:text-[color:var(--text-dim)]
              focus:outline-none focus:border-[color:var(--border-strong)]
              transition-colors
            "
          />
          {fieldErrors.name && (
            <p className="text-[13px] text-[color:var(--danger)]">
              {fieldErrors.name}
            </p>
          )}
        </div>

        {/* 유형 라디오 — 2종 */}
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
                    flex items-start gap-3 p-3 rounded-lg border cursor-pointer
                    transition-colors
                    ${
                      checked
                        ? "border-[color:var(--action)] bg-[color:var(--bg-muted)]"
                        : "border-[color:var(--border)] hover:bg-[color:var(--bg-hover)]"
                    }
                  `}
                >
                  <input
                    type="radio"
                    name="tpl-type"
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

        {/* 제목 */}
        <div className="space-y-1.5">
          <label
            htmlFor="tpl-subject"
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
            id="tpl-subject"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={!subjectRequired}
            placeholder={
              subjectRequired ? "예: 세정학원 주간테스트 안내" : "—"
            }
            maxLength={40}
            className="
              w-full h-10 rounded-lg px-3
              bg-bg-card border border-[color:var(--border)]
              text-[15px] text-[color:var(--text)]
              placeholder:text-[color:var(--text-dim)]
              focus:outline-none focus:border-[color:var(--border-strong)]
              disabled:bg-[color:var(--bg-muted)] disabled:text-[color:var(--text-dim)]
              disabled:cursor-not-allowed
              transition-colors
            "
          />
          {fieldErrors.subject && (
            <p className="text-[13px] text-[color:var(--danger)]">
              {fieldErrors.subject}
            </p>
          )}
        </div>

        {/* 본문 + 바이트 카운터 */}
        <div className="space-y-1.5">
          <label
            htmlFor="tpl-body"
            className="text-[14px] font-medium text-[color:var(--text)]"
          >
            본문
          </label>
          <textarea
            id="tpl-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="문자 본문을 입력하세요."
            rows={10}
            className="
              w-full min-h-48 rounded-lg p-3
              bg-bg-card border border-[color:var(--border)]
              text-[15px] leading-relaxed text-[color:var(--text)]
              placeholder:text-[color:var(--text-dim)]
              focus:outline-none focus:border-[color:var(--border-strong)]
              transition-colors resize-y
            "
            style={{ fontFamily: "var(--font-sans)" }}
          />
          <div className="flex items-center justify-between">
            <p
              className={`text-[13px] ${
                fieldErrors.body
                  ? "text-[color:var(--danger)]"
                  : "text-[color:var(--text-dim)]"
              }`}
            >
              {fieldErrors.body ?? " "}
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
              <AlertTriangle
                className="size-3.5"
                strokeWidth={1.75}
                aria-hidden
              />
              현재 {type} 한도({BYTE_LIMITS[type]}바이트)를 초과했습니다. 본문을
              줄이거나 LMS 로 유형을 변경하세요.
            </p>
          )}
        </div>

        {/* 광고 여부 */}
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
                마케팅·모집·특강 안내 등 광고성 내용이면 체크하세요.
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
                <strong className="font-medium">광고 발송 안전 가드:</strong>{" "}
                본문 앞에{" "}
                <code className="px-1 rounded bg-[color:var(--bg-muted)]">
                  {AD_PREFIX}
                </code>{" "}
                머리말과 끝에{" "}
                <code className="px-1 rounded bg-[color:var(--bg-muted)]">
                  080 수신거부
                </code>{" "}
                안내가 자동 삽입되며, 21시 ~ 08시 시간대에는 발송이 차단됩니다.
              </div>
            </div>
          )}
        </div>

        {/* 버튼 */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[color:var(--border)]">
          <Link
            href="/templates"
            className="
              inline-flex items-center h-10 px-4 rounded-lg
              text-[14px] text-[color:var(--text-muted)]
              hover:text-[color:var(--text)] hover:bg-[color:var(--bg-hover)]
              transition-colors
            "
          >
            취소
          </Link>
          <button
            type="submit"
            disabled={isPending || overflow}
            className="
              inline-flex items-center h-10 px-5 rounded-lg
              bg-[color:var(--action)] text-[color:var(--action-text)]
              text-[14px] font-medium
              hover:bg-[color:var(--action-hover)]
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors
            "
          >
            {isPending ? "저장 중..." : mode === "create" ? "저장" : "변경 저장"}
          </button>
        </div>
      </div>

      {/* ─── 우측 미리보기 ───────────────────────────────── */}
      <aside className="lg:sticky lg:top-6 h-fit space-y-3">
        <TestSendCard
          type={type}
          subject={subjectRequired ? subject : null}
          body={body}
          isAd={isAd}
          disabled={!body.trim() || overflow || isPending}
        />
        <SmsPreviewCard
          type={type}
          subject={subjectRequired ? subject : ""}
          body={previewBody}
          rawBytes={previewBytes}
          rawOverflow={previewOverflow}
          limit={BYTE_LIMITS[type]}
          isAd={isAd}
        />
      </aside>
    </form>
  );
}

// ─── 미리보기 카드 ─────────────────────────────────────────────

/**
 * 채팅 말풍선 형태의 SMS 미리보기.
 * 운영자가 수신자가 보게 될 화면을 상상할 수 있도록 가벼운 말풍선으로 표현.
 * 본문은 광고 가드(머리말·꼬리) 자동 부착 후 바이트까지 함께 안내.
 */
function SmsPreviewCard({
  type,
  subject,
  body,
  rawBytes,
  rawOverflow,
  limit,
  isAd,
}: {
  type: TemplateTypeLiteral;
  subject: string;
  body: string;
  rawBytes: number;
  rawOverflow: boolean;
  limit: number;
  isAd: boolean;
}) {
  return (
    <section
      aria-label="문자 미리보기"
      className="rounded-xl border border-[color:var(--border)] bg-bg-card p-5 space-y-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageSquare
            className="size-4 text-[color:var(--text-muted)]"
            strokeWidth={1.75}
            aria-hidden
          />
          <h3 className="text-[13px] font-medium uppercase tracking-wide text-[color:var(--text-muted)]">
            미리보기
          </h3>
        </div>
        <span
          className="
            inline-flex items-center px-2 py-0.5 rounded-md
            text-[11px] font-medium border
            bg-[color:var(--bg-muted)] text-[color:var(--text)]
            border-[color:var(--border-strong)]
          "
        >
          {type}
          {isAd && (
            <span className="ml-1.5 text-[color:var(--warning)]">광고</span>
          )}
        </span>
      </div>

      {/* 채팅 말풍선 */}
      <div className="rounded-2xl rounded-tl-md bg-[color:var(--bg-muted)] p-4 space-y-2">
        {subject && (
          <p className="text-[13px] font-semibold text-[color:var(--text)] leading-tight">
            {subject}
          </p>
        )}
        <pre
          className="
            whitespace-pre-wrap break-words
            text-[14px] leading-relaxed text-[color:var(--text)]
            min-h-24
          "
          style={{ fontFamily: "var(--font-sans)" }}
        >
          {body || (
            <span className="text-[color:var(--text-dim)]">
              본문을 입력하면 여기에 표시됩니다.
            </span>
          )}
        </pre>
      </div>

      {/* 메타 */}
      <dl className="space-y-1.5 text-[13px]">
        <div className="flex items-center justify-between">
          <dt className="text-[color:var(--text-muted)]">최종 바이트</dt>
          <dd
            className={`tabular-nums ${
              rawOverflow
                ? "text-[color:var(--danger)] font-medium"
                : "text-[color:var(--text)]"
            }`}
          >
            {rawBytes.toLocaleString()} / {limit.toLocaleString()}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-[color:var(--text-muted)]">유형</dt>
          <dd className="text-[color:var(--text)]">{type}</dd>
        </div>
      </dl>

      {rawOverflow && (
        <p
          role="alert"
          className="flex items-start gap-1.5 text-[12px] text-[color:var(--danger)] leading-relaxed"
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

      <p className="pt-2 border-t border-[color:var(--border)] text-[12px] text-[color:var(--text-dim)] leading-relaxed">
        발송 직전 server 단에서 동일한 가드(광고 머리말·080·야간 차단)가
        한 번 더 적용됩니다.
      </p>
    </section>
  );
}

// ─── 테스트 발송 카드 ─────────────────────────────────────────
/**
 * 본인(또는 임의) 휴대폰 번호 1건으로 즉시 테스트 발송.
 * compose 의 testSendAction 을 그대로 호출 — is_test=true 캠페인으로 기록되어
 * 운영 통계에 섞이지 않는다. server 단 광고 가드도 동일 적용.
 *
 * 활성 조건: 본문이 있고, 바이트 한도 통과, 다른 저장 작업이 진행 중이지 않음.
 * SMS 단가 7.4원 / LMS 24원 — 발송될 때마다 비용 발생 (테스트 모드라도).
 */
function TestSendCard({
  type,
  subject,
  body,
  isAd,
  disabled,
}: {
  type: TemplateTypeLiteral;
  subject: string | null;
  body: string;
  isAd: boolean;
  disabled: boolean;
}) {
  const { show: showToast } = useToast();
  const [phone, setPhone] = useState("");
  const [sending, startSending] = useTransition();

  const normalized = phone.replace(/\D/g, "");
  const phoneValid = /^01[016789][0-9]{7,8}$/.test(normalized);

  const onSend = () => {
    if (!phoneValid) {
      showToast("error", "휴대폰 번호 형식이 올바르지 않습니다 (010-...)");
      return;
    }
    startSending(async () => {
      const result = await testSendAction({
        step2: { type, subject, body, isAd },
        toPhone: normalized,
      });
      if (result.status === "success") {
        showToast("success", `테스트 발송 완료 — ${formatPhoneShort(normalized)}`);
      } else if (result.status === "dev_seed_mode") {
        showToast("error", "개발 시드 모드 — 실 발송 차단됨");
      } else if (result.status === "blocked") {
        showToast("error", `차단: ${result.reason ?? "야간 광고 차단"}`);
      } else {
        showToast(
          "error",
          `테스트 발송 실패: ${"reason" in result ? result.reason : "알 수 없는 오류"}`,
        );
      }
    });
  };

  return (
    <section
      aria-label="테스트 발송"
      className="rounded-xl border border-[color:var(--border)] bg-bg-card p-4 space-y-2"
    >
      <div className="flex items-center gap-2">
        <Send
          className="size-4 text-[color:var(--text-muted)]"
          strokeWidth={1.75}
          aria-hidden
        />
        <h3 className="text-[13px] font-medium uppercase tracking-wide text-[color:var(--text-muted)]">
          테스트 발송
        </h3>
      </div>
      <div className="flex gap-2">
        <input
          type="tel"
          inputMode="numeric"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="010-0000-0000"
          aria-label="테스트 수신 번호"
          className="
            flex-1 min-w-0 h-10 px-3 rounded-lg
            border border-[color:var(--border)] bg-bg-card
            text-[14px] text-[color:var(--text)] tabular-nums
            placeholder:text-[color:var(--text-dim)]
            focus:outline-none focus:border-[color:var(--border-strong)]
          "
        />
        <button
          type="button"
          onClick={onSend}
          disabled={disabled || !phoneValid || sending}
          className="
            shrink-0 inline-flex items-center justify-center
            h-10 px-4 rounded-lg
            bg-[color:var(--action)] text-[color:var(--action-text)]
            text-[14px] font-medium
            hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed
            transition-opacity
          "
        >
          {sending ? "발송 중…" : "보내기"}
        </button>
      </div>
      <p className="text-[12px] text-[color:var(--text-dim)] leading-relaxed">
        입력한 번호로 1건만 보냅니다. is_test 캠페인으로 기록되어 통계에는 섞이지 않으나
        실 발송 비용은 발생합니다 (SMS 7.4원 / LMS 24원).
      </p>
    </section>
  );
}

function formatPhoneShort(digits: string): string {
  // '01012345678' → '010-1234-5678' (mask 없이, 본인 입력 번호라 OK)
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return digits;
}
