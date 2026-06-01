"use client";

import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import type { SeminarListItem, GroupListItem } from "@/types/database";
import { SeminarComposeStep1Seminars } from "./seminar-compose-step-1-seminars";
import { SeminarComposeStep2Group } from "./seminar-compose-step-2-group";
import { SeminarComposeStep3Body } from "./seminar-compose-step-3-body";
import { SeminarComposeStep4Send } from "./seminar-compose-step-4-send";

/**
 * F5 · 설명회 문자 발송 4단계 위저드 (0082 invitation 모델).
 *
 * 단계:
 *   1. 설명회 선택 (다중)            — selectedSeminarIds
 *   2. 대상 학생 그룹 선택            — selectedGroupId
 *   3. 본문 작성 (SMS/LMS)            — type / subject / body
 *   4. 발송 (확인 다이얼로그)         — createSeminarBroadcastAction
 *
 * 발송 시 invitation 행이 학생당 1개 생성되고, 본문 끝에 `{초대링크}` 가 있으면
 * 학생별 `/s/<token>` URL 로 자동 치환된다. 없으면 자동 부착(서버 책임).
 *
 * 디자인:
 *   - 활성 스텝: 검정 원
 *   - 완료 스텝: 회색 채움 + 체크
 *   - 미진행: 회색 외곽선
 *
 * 일반 compose-wizard 와 별개 컴포넌트로 유지 — invitation 흐름 특유의
 * "설명회 다중 선택" / "초대링크 토큰" 개념이 일반 발송에 섞이는 것을 피한다.
 */

export type SmsType = "SMS" | "LMS";

export interface SeminarComposeState {
  selectedSeminarIds: string[];
  selectedGroupId: string;
  type: SmsType;
  subject: string | null;
  body: string;
}

interface Props {
  initialSeminarId: string | null;
  initialGroupId: string | null;
  seminars: SeminarListItem[];
  groups: GroupListItem[];
  /** 분원 — 발송 액션에 전달. master 전체 모드에서는 빈 문자열. */
  branch: string;
}

const STEP_LABELS: Array<{ index: 1 | 2 | 3 | 4; label: string }> = [
  { index: 1, label: "설명회 선택" },
  { index: 2, label: "대상 학생" },
  { index: 3, label: "본문 작성" },
  { index: 4, label: "발송" },
];

export function SeminarComposeWizard({
  initialSeminarId,
  initialGroupId,
  seminars,
  groups,
  branch,
}: Props) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  const [state, setState] = useState<SeminarComposeState>(() => ({
    selectedSeminarIds: initialSeminarId ? [initialSeminarId] : [],
    selectedGroupId: initialGroupId ?? "",
    // 설명회 안내는 보통 본문이 길어 LMS 기본.
    type: "LMS",
    subject: "설명회 안내",
    body: buildDefaultBody(seminars, initialSeminarId),
  }));

  const goNext = () => setStep((s) => (s < 4 ? ((s + 1) as 1 | 2 | 3 | 4) : s));
  const goPrev = () => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4) : s));

  const selectedSeminars = useMemo<SeminarListItem[]>(
    () =>
      state.selectedSeminarIds
        .map((id) => seminars.find((s) => s.id === id))
        .filter((v): v is SeminarListItem => Boolean(v)),
    [seminars, state.selectedSeminarIds],
  );

  const selectedGroup = useMemo<GroupListItem | null>(
    () => groups.find((g) => g.id === state.selectedGroupId) ?? null,
    [groups, state.selectedGroupId],
  );

  return (
    <div className="space-y-6">
      {/* 스텝 인디케이터 */}
      <ol
        className="flex items-center gap-2 sm:gap-4"
        aria-label="설명회 발송 단계"
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
                        : "border border-[color:var(--border-strong)] text-[color:var(--text-muted)] bg-[color:var(--bg-card)]",
                  ].join(" ")}
                >
                  {isDone ? (
                    <Check className="size-3.5" strokeWidth={2.25} aria-hidden />
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
      <div className="rounded-xl border border-[color:var(--border)] bg-bg-card p-6 space-y-6">
        {step === 1 && (
          <SeminarComposeStep1Seminars
            seminars={seminars}
            selectedIds={state.selectedSeminarIds}
            onChange={(ids) =>
              setState((p) => ({
                ...p,
                selectedSeminarIds: ids,
                // 기본 본문에 첫 설명회 메타 반영.
                body:
                  p.body.trim().length === 0 ||
                  p.body === buildDefaultBody(seminars, null) ||
                  p.body === buildDefaultBody(seminars, p.selectedSeminarIds[0] ?? null)
                    ? buildDefaultBody(seminars, ids[0] ?? null)
                    : p.body,
              }))
            }
          />
        )}
        {step === 2 && (
          <SeminarComposeStep2Group
            groups={groups}
            groupId={state.selectedGroupId}
            onGroupIdChange={(id) =>
              setState((p) => ({ ...p, selectedGroupId: id }))
            }
          />
        )}
        {step === 3 && (
          <SeminarComposeStep3Body
            state={state}
            onChange={(patch) => setState((p) => ({ ...p, ...patch }))}
            selectedSeminars={selectedSeminars}
            selectedGroup={selectedGroup}
          />
        )}
        {step === 4 && selectedGroup && selectedSeminars.length > 0 && (
          <SeminarComposeStep4Send
            state={state}
            selectedSeminars={selectedSeminars}
            selectedGroup={selectedGroup}
            branch={branch}
            onBackToBody={() => setStep(3)}
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
              border border-[color:var(--border)] bg-bg-card
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
              disabled={!canProceed(step, state)}
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
            <span aria-hidden />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 다음 버튼 활성화 ────────────────────────────────────────

function canProceed(step: 1 | 2 | 3 | 4, state: SeminarComposeState): boolean {
  if (step === 1) return state.selectedSeminarIds.length > 0;
  if (step === 2) return state.selectedGroupId.length > 0;
  if (step === 3) {
    if (!state.body.trim()) return false;
    if (
      state.type === "LMS" &&
      (!state.subject || state.subject.trim().length === 0)
    ) {
      return false;
    }
    return true;
  }
  return false;
}

// ─── 기본 본문 빌더 ──────────────────────────────────────────

/**
 * 선택된 설명회의 일시·장소를 자연어로 펼친 기본 본문.
 * 사용자가 본문을 직접 편집했으면 덮어쓰지 않는다 (위의 onChange 분기 참고).
 */
function buildDefaultBody(
  seminars: SeminarListItem[],
  primaryId: string | null,
): string {
  const primary = primaryId
    ? seminars.find((s) => s.id === primaryId) ?? null
    : null;

  const lines: string[] = ["[설명회 안내]"];
  if (primary) {
    lines.push(primary.name);
    if (primary.held_at) {
      // KST 표시는 서버에서 정확하지만 위저드 미리보기 용으로 간단 포맷.
      const dt = new Date(primary.held_at);
      const md = `${dt.getMonth() + 1}/${dt.getDate()}`;
      const hm = `${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
      lines.push(`${md} ${hm}${primary.venue ? ` · ${primary.venue}` : ""}`);
    } else if (primary.venue) {
      lines.push(primary.venue);
    }
  } else {
    lines.push("자녀의 학습 안내 드립니다.");
  }
  lines.push("");
  lines.push("신청하기: {초대링크}");
  return lines.join("\n");
}
