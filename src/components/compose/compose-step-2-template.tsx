"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Megaphone } from "lucide-react";
import type { TemplateRow } from "@/types/database";
import { byteProgress } from "@/lib/messaging/sms-bytes";
import { BYTE_LIMITS, type TemplateTypeLiteral } from "@/lib/schemas/template";
import { TemplateTypeBadge } from "@/components/templates/template-type-badge";
import type { ComposeStep2State } from "./compose-wizard";

/**
 * F3 Part B · Step 2 — 템플릿 선택 또는 직접 작성.
 *
 * 모드:
 *   - "template" : 기존 템플릿 선택 (드롭다운 + 본문 미리보기)
 *   - "inline"   : 직접 작성 (유형 라디오 / 제목 / 본문 + 바이트 카운터 / [광고])
 *
 * 템플릿 선택 시 type/subject/body/isAd 가 자동 채워지며, 사용자가 추가로 inline 모드로
 * 전환해서 본문을 수정해도 templateId 는 유지(=베이스 추적). 단 실제 발송 본문은
 * 항상 step2 상태값을 사용.
 */
const TYPE_OPTIONS: Array<{
  value: TemplateTypeLiteral;
  label: string;
  hint: string;
}> = [
  { value: "SMS", label: "SMS · 단문", hint: "90바이트" },
  { value: "LMS", label: "LMS · 장문", hint: "2000바이트" },
  { value: "ALIMTALK", label: "알림톡", hint: "1000바이트" },
];

interface Props {
  templates: TemplateRow[];
  value: ComposeStep2State;
  onChange: (v: ComposeStep2State) => void;
}

export function ComposeStep2Template({ templates, value, onChange }: Props) {
  // 초기 모드: templateId 가 있으면 template 모드, 없으면 inline
  const [mode, setMode] = useState<"template" | "inline">(
    value.templateId ? "template" : "inline",
  );

  // 모드 전환 시 templateId 정리
  useEffect(() => {
    if (mode === "inline" && value.templateId !== undefined) {
      onChange({ ...value, templateId: undefined });
    }
    // mode 가 template 인 동안엔 templateId 가 없을 수 있음 (사용자가 아직 선택 전)
    // 그건 그대로 둔다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
          문자 본문
        </h2>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          저장된 템플릿을 불러오거나 새로 작성할 수 있습니다.
        </p>
      </div>

      {/* 모드 전환 */}
      <fieldset className="space-y-2">
        <legend className="sr-only">본문 입력 방식</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <ModeRadio
            checked={mode === "template"}
            onSelect={() => setMode("template")}
            title="기존 템플릿 사용"
            description="저장된 템플릿에서 골라 발송합니다."
          />
          <ModeRadio
            checked={mode === "inline"}
            onSelect={() => setMode("inline")}
            title="직접 작성"
            description="이번 발송용으로 본문을 즉석에서 작성합니다."
          />
        </div>
      </fieldset>

      {mode === "template" ? (
        <TemplatePicker
          templates={templates}
          value={value}
          onChange={onChange}
        />
      ) : (
        <InlineComposer value={value} onChange={onChange} />
      )}
    </div>
  );
}

// ─── 모드 라디오 ─────────────────────────────────────────────

function ModeRadio({
  checked,
  onSelect,
  title,
  description,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  description: string;
}) {
  return (
    <label
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
        name="compose-mode"
        checked={checked}
        onChange={onSelect}
        className="mt-1 size-4 accent-[color:var(--action)]"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-[14px] font-medium text-[color:var(--text)]">
          {title}
        </span>
        <span className="text-[12px] text-[color:var(--text-muted)]">
          {description}
        </span>
      </span>
    </label>
  );
}

// ─── 템플릿 선택 ─────────────────────────────────────────────

function TemplatePicker({
  templates,
  value,
  onChange,
}: {
  templates: TemplateRow[];
  value: ComposeStep2State;
  onChange: (v: ComposeStep2State) => void;
}) {
  const selected = useMemo<TemplateRow | null>(() => {
    if (!value.templateId) return null;
    return templates.find((t) => t.id === value.templateId) ?? null;
  }, [templates, value.templateId]);

  const onPick = (id: string) => {
    if (!id) {
      onChange({ ...value, templateId: undefined });
      return;
    }
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    onChange({
      templateId: t.id,
      type: t.type,
      subject: t.subject,
      body: t.body,
      isAd: t.is_ad,
    });
  };

  return (
    <div className="space-y-4">
      {templates.length === 0 ? (
        <div
          role="alert"
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-4 py-3 text-[14px] text-[color:var(--text-muted)]"
        >
          저장된 템플릿이 없습니다.{" "}
          <Link
            href="/templates/new"
            className="underline text-[color:var(--text)] hover:text-[color:var(--action)]"
          >
            새 템플릿 만들기
          </Link>
        </div>
      ) : (
        <div className="space-y-1.5">
          <label
            htmlFor="compose-template"
            className="text-[14px] font-medium text-[color:var(--text)]"
          >
            템플릿 선택
          </label>
          <select
            id="compose-template"
            value={value.templateId ?? ""}
            onChange={(e) => onPick(e.target.value)}
            className="
              w-full h-10 rounded-lg px-3
              bg-white border border-[color:var(--border)]
              text-[15px] text-[color:var(--text)]
              focus:outline-none focus:border-[color:var(--border-strong)]
              cursor-pointer
            "
          >
            <option value="">— 템플릿을 선택하세요 —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                [{t.type === "ALIMTALK" ? "알림톡" : t.type}] {t.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {selected && (
        <section
          aria-label="템플릿 미리보기"
          className="rounded-lg border border-[color:var(--border)] bg-white p-4 space-y-3"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[15px] font-semibold text-[color:var(--text)]">
              {selected.name}
            </span>
            <TemplateTypeBadge type={selected.type} />
            {selected.is_ad && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-medium border border-[color:var(--danger)] text-[color:var(--danger)]">
                광고
              </span>
            )}
          </div>
          {selected.subject && (
            <div className="text-[13px] text-[color:var(--text-muted)]">
              <span className="font-medium text-[color:var(--text)]">제목 </span>
              {selected.subject}
            </div>
          )}
          <pre
            className="
              whitespace-pre-wrap break-words
              text-[14px] leading-relaxed text-[color:var(--text)]
              p-3 rounded-md bg-[color:var(--bg-muted)]
            "
            style={{ fontFamily: "var(--font-sans)" }}
          >
            {selected.body}
          </pre>
          <p className="text-[12px] text-[color:var(--text-dim)]">
            본문 수정이 필요하면 위에서 &lsquo;직접 작성&rsquo; 모드로
            전환하세요. (모드 전환 시 템플릿 본문은 유지됩니다)
          </p>
        </section>
      )}
    </div>
  );
}

// ─── 직접 작성 ───────────────────────────────────────────────

function InlineComposer({
  value,
  onChange,
}: {
  value: ComposeStep2State;
  onChange: (v: ComposeStep2State) => void;
}) {
  const progress = byteProgress(value.body, value.type);
  const overflow = progress.bytes > progress.limit;
  const subjectRequired = value.type !== "SMS";

  const onTypeChange = (type: TemplateTypeLiteral) => {
    if (type === "SMS") {
      onChange({ ...value, type, subject: null });
    } else {
      onChange({ ...value, type });
    }
  };

  return (
    <div className="space-y-5">
      {/* 유형 */}
      <fieldset className="space-y-2">
        <legend className="text-[14px] font-medium text-[color:var(--text)]">
          유형
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {TYPE_OPTIONS.map((opt) => {
            const checked = value.type === opt.value;
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
                  name="compose-inline-type"
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
          htmlFor="compose-subject"
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
          id="compose-subject"
          type="text"
          value={value.subject ?? ""}
          onChange={(e) => onChange({ ...value, subject: e.target.value })}
          disabled={!subjectRequired}
          placeholder={subjectRequired ? "예: 세정학원 안내" : "—"}
          maxLength={40}
          className="
            w-full h-10 rounded-lg px-3
            bg-white border border-[color:var(--border)]
            text-[15px] text-[color:var(--text)]
            placeholder:text-[color:var(--text-dim)]
            focus:outline-none focus:border-[color:var(--border-strong)]
            disabled:bg-[color:var(--bg-muted)] disabled:text-[color:var(--text-dim)]
            disabled:cursor-not-allowed
          "
        />
      </div>

      {/* 본문 */}
      <div className="space-y-1.5">
        <label
          htmlFor="compose-body"
          className="text-[14px] font-medium text-[color:var(--text)]"
        >
          본문
        </label>
        <textarea
          id="compose-body"
          value={value.body}
          onChange={(e) => onChange({ ...value, body: e.target.value })}
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
        <div className="flex items-center justify-end">
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
            현재 {value.type} 한도({BYTE_LIMITS[value.type]}바이트)를 초과했습니다.
            본문을 줄이거나 LMS 로 유형을 변경하세요.
          </p>
        )}
      </div>

      {/* 광고 */}
      <div className="space-y-2">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={value.isAd}
            onChange={(e) => onChange({ ...value, isAd: e.target.checked })}
            className="mt-1 size-4 accent-[color:var(--action)]"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-[14px] font-medium text-[color:var(--text)]">
              광고성 문자로 발송
            </span>
            <span className="text-[12px] text-[color:var(--text-muted)]">
              모집·특강·이벤트 등 마케팅 메시지면 체크하세요.
            </span>
          </span>
        </label>

        {value.isAd && (
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
              본문 앞에 <code className="px-1 rounded bg-white">[광고]</code>{" "}
              prefix 와 끝에{" "}
              <code className="px-1 rounded bg-white">080 수신거부</code>{" "}
              안내가 자동 삽입되며, 21시 ~ 08시에는 발송이 차단됩니다.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
