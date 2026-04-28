"use client";

import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import type { GroupListItem, TemplateRow } from "@/types/database";
import type { TemplateTypeLiteral } from "@/lib/schemas/template";
import type { PreviewResult } from "@/lib/messaging/preview-recipients";
import { ComposeStep1Group } from "./compose-step-1-group";
import { ComposeStep2Template } from "./compose-step-2-template";
import { ComposeStep3Preview } from "./compose-step-3-preview";
import { ComposeStep4Send } from "./compose-step-4-send";

/**
 * F3 Part B · 4단계 발송 위저드.
 *
 * 상단 스텝 인디케이터 + 단계별 카드 본문.
 * 모든 단계 상태는 본 컴포넌트에서 관리하고 자식엔 props 로 내려준다.
 *
 * 단계:
 *   1. 그룹 선택        — groupId
 *   2. 템플릿/직접 작성  — templateId? + type/subject/body/isAd
 *   3. 미리보기          — previewAction 호출 + 캠페인 제목 입력
 *   4. 발송              — 즉시 / 예약 → sendNow / schedule
 *
 * 디자인:
 *   - 활성 스텝: 검정 원
 *   - 완료 스텝: 회색 채움 + 체크
 *   - 미진행: 회색 외곽선
 *   - 라벨 12px
 */

export interface ComposeStep2State {
  templateId?: string;
  type: TemplateTypeLiteral;
  subject: string | null;
  body: string;
  isAd: boolean;
}

interface Props {
  initialGroupId: string | null;
  initialTemplateId: string | null;
  groups: GroupListItem[];
  templates: TemplateRow[];
}

const STEP_LABELS: Array<{ index: 1 | 2 | 3 | 4; label: string }> = [
  { index: 1, label: "그룹 선택" },
  { index: 2, label: "템플릿" },
  { index: 3, label: "미리보기" },
  { index: 4, label: "발송" },
];

export function ComposeWizard({
  initialGroupId,
  initialTemplateId,
  groups,
  templates,
}: Props) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // ─── 1단계 ───
  const [groupId, setGroupId] = useState<string>(initialGroupId ?? "");

  // ─── 2단계 ───
  const initialTemplate = useMemo<TemplateRow | null>(() => {
    if (!initialTemplateId) return null;
    return templates.find((t) => t.id === initialTemplateId) ?? null;
  }, [initialTemplateId, templates]);

  const [step2, setStep2] = useState<ComposeStep2State>(() => {
    if (initialTemplate) {
      return {
        templateId: initialTemplate.id,
        type: initialTemplate.type,
        subject: initialTemplate.subject,
        body: initialTemplate.body,
        isAd: initialTemplate.is_ad,
      };
    }
    return {
      templateId: undefined,
      type: "LMS",
      subject: null,
      body: "",
      isAd: false,
    };
  });

  // ─── 3단계 ───
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [title, setTitle] = useState("");

  // ─── 4단계 ───
  const [scheduleAt, setScheduleAt] = useState<string | null>(null);

  const goNext = () => {
    setStep((s) => (s < 4 ? ((s + 1) as 1 | 2 | 3 | 4) : s));
  };
  const goPrev = () => {
    setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4) : s));
  };

  const selectedGroup = useMemo<GroupListItem | null>(
    () => groups.find((g) => g.id === groupId) ?? null,
    [groups, groupId],
  );

  return (
    <div className="space-y-6">
      {/* 스텝 인디케이터 */}
      <ol
        className="flex items-center gap-2 sm:gap-4"
        aria-label="발송 단계"
      >
        {STEP_LABELS.map((s, i) => {
          const isCurrent = s.index === step;
          const isDone = s.index < step;
          return (
            <li key={s.index} className="flex items-center gap-2 sm:gap-3">
              <div className="flex flex-col items-center gap-1">
                <span
                  aria-current={isCurrent ? "step" : undefined}
                  className={[
                    "inline-flex items-center justify-center size-7 rounded-full text-[12px] font-semibold tabular-nums",
                    isCurrent
                      ? "bg-[color:var(--action)] text-[color:var(--action-text)]"
                      : isDone
                        ? "bg-[color:var(--text-muted)] text-white"
                        : "border border-[color:var(--border-strong)] text-[color:var(--text-muted)] bg-[color:var(--bg)]",
                  ].join(" ")}
                >
                  {isDone ? (
                    <Check
                      className="size-3.5"
                      strokeWidth={2.25}
                      aria-hidden
                    />
                  ) : (
                    s.index
                  )}
                </span>
                <span
                  className={[
                    "text-[12px] leading-none",
                    isCurrent
                      ? "text-[color:var(--text)] font-medium"
                      : "text-[color:var(--text-muted)]",
                  ].join(" ")}
                >
                  {s.label}
                </span>
              </div>
              {i < STEP_LABELS.length - 1 && (
                <span
                  aria-hidden
                  className="hidden sm:block w-8 h-px bg-[color:var(--border)] mb-5"
                />
              )}
            </li>
          );
        })}
      </ol>

      {/* 본문 */}
      <div className="rounded-xl border border-[color:var(--border)] bg-white p-6 space-y-6">
        {step === 1 && (
          <ComposeStep1Group
            groups={groups}
            groupId={groupId}
            onGroupIdChange={setGroupId}
          />
        )}
        {step === 2 && (
          <ComposeStep2Template
            templates={templates}
            value={step2}
            onChange={setStep2}
          />
        )}
        {step === 3 && selectedGroup && (
          <ComposeStep3Preview
            groupId={groupId}
            selectedGroup={selectedGroup}
            step2={step2}
            preview={preview}
            onPreview={setPreview}
            title={title}
            onTitleChange={setTitle}
          />
        )}
        {step === 4 && selectedGroup && preview && (
          <ComposeStep4Send
            groupId={groupId}
            selectedGroup={selectedGroup}
            step2={step2}
            preview={preview}
            title={title}
            scheduleAt={scheduleAt}
            onScheduleAtChange={setScheduleAt}
            onBackToPreview={() => setStep(3)}
          />
        )}

        {/* 네비게이션 버튼 */}
        <div className="flex items-center justify-between gap-2 pt-4 border-t border-[color:var(--border)]">
          <button
            type="button"
            onClick={goPrev}
            disabled={step === 1}
            className="
              inline-flex items-center h-10 px-4 rounded-lg
              border border-[color:var(--border)] bg-white
              text-[14px] text-[color:var(--text)]
              hover:bg-[color:var(--bg-hover)]
              disabled:opacity-40 disabled:cursor-not-allowed
              transition-colors
            "
          >
            이전
          </button>

          {step < 4 ? (
            <button
              type="button"
              onClick={goNext}
              disabled={!canProceed(step, groupId, step2, preview, title)}
              className="
                inline-flex items-center h-10 px-5 rounded-lg
                bg-[color:var(--action)] text-[color:var(--action-text)]
                text-[14px] font-medium
                hover:bg-[color:var(--action-hover)]
                disabled:opacity-40 disabled:cursor-not-allowed
                transition-colors
              "
            >
              다음
            </button>
          ) : (
            // step 4 의 발송 버튼은 ComposeStep4Send 안에서 자체 렌더 (결과 표시 함께)
            <span aria-hidden />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 다음 버튼 활성화 로직 ────────────────────────────────────

function canProceed(
  step: 1 | 2 | 3 | 4,
  groupId: string,
  step2: ComposeStep2State,
  preview: PreviewResult | null,
  title: string,
): boolean {
  if (step === 1) return groupId.length > 0;
  if (step === 2) {
    if (!step2.body.trim()) return false;
    if (step2.type !== "SMS" && (!step2.subject || step2.subject.trim().length === 0)) {
      return false;
    }
    return true;
  }
  if (step === 3) {
    if (!preview) return false;
    if (preview.blockedByQuietHours) return false;
    if (preview.recipientCount === 0) return false;
    if (!title.trim()) return false;
    return true;
  }
  return false;
}
