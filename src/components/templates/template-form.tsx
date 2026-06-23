"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { AlertTriangle, Megaphone, Send } from "lucide-react";
import { BYTE_LIMITS, type TemplateTypeLiteral } from "@/lib/schemas/template";
import { byteProgress, countEucKrBytes } from "@/lib/messaging/sms-bytes";
import { insertAdSubjectTag } from "@/lib/messaging/guards";
import {
  createTemplateAction,
  updateTemplateAction,
} from "@/app/(features)/templates/actions";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PhonePreviewCard } from "@/components/messaging/phone-preview-card";
import { TestSendCard } from "@/components/messaging/test-send-card";

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

/** 광고성 발송 시 자동 삽입되는 머리말. 실 발송 가드와 표기 일치 (법령 강제). */
const AD_PREFIX = "(광고)";
/** 학원명 기본값 — 운영팀이 footer 편집 가능. */
const DEFAULT_ACADEMY_NAME = "세정학원";
/** sendon 정책상 발송 시 공식 080 번호로 치환될 수 있음을 안내. */
const DEFAULT_UNSUBSCRIBE_PHONE = "080-XXX-XXXX";

export function TemplateForm({ mode, templateId, initial }: Props) {
  const router = useRouter();
  const { show: showToast } = useToast();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState(initial.name);
  const [type, setType] = useState<TemplateTypeLiteral>(initial.type);
  const [subject, setSubject] = useState(initial.subject ?? "");
  const [body, setBody] = useState(initial.body);
  const [isAd, setIsAd] = useState(initial.is_ad);

  // 광고 footer — 운영팀이 미리보기에서 편집 가능. 템플릿 DB 에는 저장 X
  // (캠페인 메타 단위 정책이며, 컬럼 추가 시 영구 저장으로 옮길 예정).
  const [footerUseDefault, setFooterUseDefault] = useState(true);
  const [unsubscribePhone, setUnsubscribePhone] = useState(
    DEFAULT_UNSUBSCRIBE_PHONE,
  );

  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // 변경 저장 확인 다이얼로그 — 사용자 요청(2026-05-21): 템플릿 수정 저장 시
  // 한 번 더 확인. 신규 생성은 가벼운 작업이라 그대로 즉시 저장.
  const [confirmingSave, setConfirmingSave] = useState(false);

  const progress = useMemo(() => byteProgress(body, type), [body, type]);
  const overflow = progress.bytes > progress.limit;
  const subjectRequired = type === "LMS";

  /** footer "기본값 사용" 토글이 켜져 있으면 수신거부 번호를 기본값으로 강제 동기. */
  useEffect(() => {
    if (footerUseDefault) {
      setUnsubscribePhone(DEFAULT_UNSUBSCRIBE_PHONE);
    }
  }, [footerUseDefault]);

  /**
   * 말풍선에 노출할 본문 — (광고) prefix 만 본문 말풍선 앞에 합치고,
   * 학원명·080 footer 는 PhonePreviewCard 가 별도 말풍선으로 렌더.
   *
   * 단, 바이트 계산은 실 발송본 기준이므로 footer 까지 포함해서 셈한다.
   */
  const finalSendBody = useMemo(() => {
    if (!isAd) return body;
    const trimmed = body.trimEnd();
    // 실제 발송 insertAdTag 와 동일: 첫 줄 (광고) / 둘째 줄 세정학원 / 본문 / 무료수신거부.
    return `${AD_PREFIX}\n${DEFAULT_ACADEMY_NAME}\n${trimmed}\n무료수신거부 ${unsubscribePhone}`;
  }, [body, isAd, unsubscribePhone]);

  const previewBytes = useMemo(
    () => countEucKrBytes(finalSendBody),
    [finalSendBody],
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
    if (
      subjectRequired &&
      countEucKrBytes(insertAdSubjectTag(subject, isAd) ?? "") > 40
    ) {
      errs.subject = "제목은 40byte 이내 (한글 20자 / 영문 40자)";
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

    // 수정 모드는 한 번 더 확인. 신규는 즉시 저장.
    if (mode === "edit") {
      setConfirmingSave(true);
      return;
    }
    doSave();
  };

  const doSave = () => {
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
          setConfirmingSave(false);
          return;
        }
        const result = await updateTemplateAction({
          id: templateId,
          ...payload,
        });
        if (result.status === "success") {
          setNotice("저장되었습니다.");
          setConfirmingSave(false);
          router.refresh();
        } else if (result.status === "dev_seed_mode") {
          setNotice(
            "개발용 시드 데이터라 실제 수정되지 않습니다. Supabase 연결 후 동작합니다.",
          );
          setConfirmingSave(false);
        } else {
          setErrorMsg(result.reason);
          setConfirmingSave(false);
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
          <div className="flex items-center justify-between gap-2">
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
            {subjectRequired && (() => {
              // LMS 제목 EUC-KR byte 기준 40byte (사용자 정책 2026-05-22).
              // 한글 1자 = 2byte / 영문 1자 = 1byte. 광고면 (광고) prefix 포함.
              const sbBytes = countEucKrBytes(
                insertAdSubjectTag(subject, isAd) ?? "",
              );
              const sbOver = sbBytes > 40;
              return (
                <span
                  className={`text-[12px] tabular-nums ${
                    sbOver
                      ? "text-[color:var(--danger)] font-medium"
                      : "text-[color:var(--text-muted)]"
                  }`}
                  aria-label={`제목 ${sbBytes} / 40 byte`}
                >
                  {sbBytes} / 40 byte
                </span>
              );
            })()}
          </div>
          <input
            id="tpl-subject"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={!subjectRequired}
            placeholder={
              subjectRequired ? "예: 세정학원 주간테스트 안내" : "—"
            }
            // maxLength 는 글자 수 가드라 byte 와 다름. byte 한도(40)는 카운터
            // 빨강 + validate() 에서 잡고, input 자체는 글자 수 60 자(한글 30
            // = 60byte 안전 여유) 까지만 허용.
            maxLength={60}
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
                안내가 자동 삽입됩니다.
              </div>
            </div>
          )}
        </div>

        {/* ─── 광고 footer 편집 ──────────────────────────── */}
        {isAd && (
          <section
            aria-label="광고 푸터 편집"
            className="space-y-3 rounded-lg border border-[color:var(--border-strong)] bg-bg-card p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-[14px] font-medium text-[color:var(--text)]">
                  광고 푸터 편집
                </h3>
                <p className="mt-0.5 text-[12px] text-[color:var(--text-muted)] leading-relaxed">
                  광고 캠페인 말미에 붙는 무료수신거부 번호입니다. 발신
                  학원명(세정학원)은 본문 머리 (광고) 아래에 자동으로 들어갑니다.
                </p>
              </div>
              <label className="flex items-center gap-2 shrink-0 cursor-pointer">
                <input
                  type="checkbox"
                  checked={footerUseDefault}
                  onChange={(e) => setFooterUseDefault(e.target.checked)}
                  className="size-4 accent-[color:var(--action)]"
                />
                <span className="text-[13px] text-[color:var(--text)]">
                  기본값 사용
                </span>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label
                  htmlFor="tpl-footer-phone"
                  className="text-[13px] text-[color:var(--text-muted)]"
                >
                  수신거부 번호
                </label>
                <input
                  id="tpl-footer-phone"
                  type="text"
                  value={unsubscribePhone}
                  onChange={(e) => setUnsubscribePhone(e.target.value)}
                  disabled={footerUseDefault}
                  maxLength={20}
                  className="
                    w-full h-10 rounded-lg px-3
                    bg-bg-card border border-[color:var(--border-strong)]
                    text-[14px] tabular-nums text-[color:var(--text)]
                    placeholder:text-[color:var(--text-dim)]
                    focus:outline-none focus:border-[color:var(--action)]
                    disabled:bg-[color:var(--bg-muted)] disabled:text-[color:var(--text-dim)]
                    disabled:cursor-not-allowed
                    transition-colors
                  "
                />
              </div>
            </div>

            <p className="text-[12px] text-[color:var(--text-muted)] leading-relaxed">
              발송 시 sendon 의 공식 080 번호로 자동 치환될 수 있습니다.
            </p>
          </section>
        )}

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
        <PhonePreviewCard
          type={type}
          subject={subjectRequired ? subject : null}
          body={body}
          isAd={isAd}
          rawBytes={previewBytes}
          rawOverflow={previewOverflow}
          limit={BYTE_LIMITS[type]}
          editable
          onSubjectChange={
            subjectRequired ? (next) => setSubject(next) : undefined
          }
          onBodyChange={(next) => setBody(next)}
          footer={
            isAd
              ? {
                  unsubscribePhone,
                  onUnsubscribePhoneChange: footerUseDefault
                    ? undefined
                    : (v) => setUnsubscribePhone(v),
                }
              : undefined
          }
        />
        <p className="text-[12px] text-[color:var(--text-dim)] leading-relaxed px-1">
          발송 직전 server 단에서 동일한 가드(광고 머리말·080·야간 차단)가
          한 번 더 적용됩니다.
        </p>
      </aside>

      {confirmingSave && (
        <ConfirmDialog
          title="변경사항을 저장할까요?"
          description="저장하면 템플릿의 본문·유형이 즉시 갱신되며, 이후 발송부터 새 내용이 사용됩니다."
          confirmLabel="저장"
          busy={isPending}
          onCancel={() => setConfirmingSave(false)}
          onConfirm={doSave}
        />
      )}
    </form>
  );
}

// TestSendCard 는 src/components/messaging/test-send-card.tsx 로 추출됨
// (compose-step-3 과 공유하기 위해). template-form 은 import 만 사용.
