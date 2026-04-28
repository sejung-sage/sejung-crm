"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, Megaphone } from "lucide-react";
import { BYTE_LIMITS, type TemplateTypeLiteral } from "@/lib/schemas/template";
import { byteProgress } from "@/lib/messaging/sms-bytes";
import {
  createTemplateAction,
  updateTemplateAction,
} from "@/app/(features)/templates/actions";

export interface TemplateFormInitial {
  name: string;
  subject: string | null;
  body: string;
  type: TemplateTypeLiteral;
  teacher_name: string | null;
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
  { value: "ALIMTALK", label: "알림톡", hint: "1000바이트" },
];

/**
 * F3-01 · 템플릿 생성/수정 공용 폼.
 *
 * 기능:
 *  - 유형 라디오 3개 (유형 변경 시 제목 활성 여부·바이트 한도 변경)
 *  - 제목 (LMS/알림톡만 활성)
 *  - 본문 textarea + 실시간 바이트 카운터 (한도 초과 시 빨간색 + 제출 차단)
 *  - 강사명 입력
 *  - [광고] 체크박스 + 체크 시 안전가드 안내 배너
 *  - 저장(useTransition 로딩) / 취소(링크)
 *  - dev_seed_mode 응답은 회색 안내 박스
 */
export function TemplateForm({ mode, templateId, initial }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState(initial.name);
  const [type, setType] = useState<TemplateTypeLiteral>(initial.type);
  const [subject, setSubject] = useState(initial.subject ?? "");
  const [body, setBody] = useState(initial.body);
  const [teacherName, setTeacherName] = useState(initial.teacher_name ?? "");
  const [isAd, setIsAd] = useState(initial.is_ad);

  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const progress = useMemo(() => byteProgress(body, type), [body, type]);
  const overflow = progress.bytes > progress.limit;
  const subjectRequired = type !== "SMS";

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
      errs.subject = "LMS/알림톡은 제목이 필수입니다";
    }
    if (subject.trim().length > 40) {
      errs.subject = "제목은 40자 이내";
    }
    if (!body.trim()) errs.body = "본문은 필수입니다";
    if (overflow) errs.body = "바이트 한도를 초과했습니다";
    if (teacherName.trim().length > 20) {
      errs.teacher_name = "강사명은 20자 이내";
    }
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
        teacher_name: teacherName.trim() ? teacherName.trim() : null,
        is_ad: isAd,
      };

      if (mode === "create") {
        const result = await createTemplateAction(payload);
        if (result.status === "success") {
          router.push(`/templates/${result.id}/edit`);
          router.refresh();
        } else if (result.status === "dev_seed_mode") {
          setNotice(
            "개발용 시드 데이터라 실제 저장되지 않습니다. Supabase 연결 후 동작합니다.",
          );
        } else {
          setErrorMsg(result.reason);
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
      className="space-y-6 max-w-3xl"
      aria-busy={isPending}
    >
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
            bg-white border border-[color:var(--border)]
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

      {/* 유형 라디오 */}
      <fieldset className="space-y-2">
        <legend className="text-[14px] font-medium text-[color:var(--text)]">
          유형
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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
            bg-white border border-[color:var(--border)]
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
          rows={8}
          className="
            w-full min-h-40 rounded-lg p-3
            bg-white border border-[color:var(--border)]
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

      {/* 강사명 */}
      <div className="space-y-1.5">
        <label
          htmlFor="tpl-teacher"
          className="text-[14px] font-medium text-[color:var(--text)]"
        >
          강사명
          <span className="ml-2 text-[12px] text-[color:var(--text-dim)]">
            선택
          </span>
        </label>
        <input
          id="tpl-teacher"
          type="text"
          value={teacherName}
          onChange={(e) => setTeacherName(e.target.value)}
          placeholder="예: 김정우T"
          maxLength={20}
          className="
            w-full h-10 rounded-lg px-3
            bg-white border border-[color:var(--border)]
            text-[15px] text-[color:var(--text)]
            placeholder:text-[color:var(--text-dim)]
            focus:outline-none focus:border-[color:var(--border-strong)]
            transition-colors
          "
        />
        {fieldErrors.teacher_name && (
          <p className="text-[13px] text-[color:var(--danger)]">
            {fieldErrors.teacher_name}
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
              본문 앞에 <code className="px-1 rounded bg-[color:var(--bg-muted)]">[광고]</code>{" "}
              prefix 와 끝에{" "}
              <code className="px-1 rounded bg-[color:var(--bg-muted)]">080 수신거부</code>{" "}
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
    </form>
  );
}
