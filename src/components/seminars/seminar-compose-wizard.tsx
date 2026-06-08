"use client";

import { useMemo, useState } from "react";
import { AlertCircle } from "lucide-react";
import type { ClassSignupOption, GroupListItem } from "@/types/database";
import { SeminarComposeStep1Seminars } from "./seminar-compose-step-1-seminars";
import { SeminarComposeStep2Group } from "./seminar-compose-step-2-group";
import { SeminarComposeStep3Body } from "./seminar-compose-step-3-body";
import { SeminarComposeStep4Send } from "./seminar-compose-step-4-send";

/**
 * F5 · 설명회 문자 발송 — 단일 페이지 폼 (0084/0085 새 모델).
 *
 * 2026-06-02 재구성: 옛 4-step 위저드(다음/이전 navigation) → 한 화면 4 섹션
 * 폼. Aca 운영자 패턴에 맞춰 모든 영역을 동시에 보면서 편집 가능. 발송 카드는
 * 조건 충족 시 활성화, 그 전에는 부족한 항목 체크리스트.
 *
 * 섹션:
 *   1. 설명회 선택 (다중)            — selectedClassIds (검색·월 필터·다중 선택)
 *   2. 대상 학생 그룹                 — selectedGroupId
 *   3. 본문 작성 (SMS/LMS)            — type / subject / body / isAd
 *   4. 발송                            — 발송 버튼 + 결과 (조건 충족 후 활성)
 */

export type SmsType = "SMS" | "LMS";

export interface SeminarComposeState {
  /** 선택된 강좌(=설명회) id 배열. 0084 새 모델 — 옛 seminar id 아님. */
  selectedClassIds: string[];
  selectedGroupId: string;
  type: SmsType;
  subject: string | null;
  body: string;
  /** 광고성 문자 여부. true → (광고) prefix + 무료수신거부 footer + 야간 차단. */
  isAd: boolean;
  /**
   * 중복 신청 허용 여부 (0087). true(기본)=학부모가 받은 여러 설명회를 동시에
   * 신청 가능. false=한 명당 1개만 신청 가능(1개 신청 시 나머지 잠김 →
   * claim 이 'limit_reached' 반환). 현행 동작 보존을 위해 기본 true.
   */
  allowMultiple: boolean;
}

interface Props {
  initialClassId: string | null;
  initialGroupId: string | null;
  classes: ClassSignupOption[];
  groups: GroupListItem[];
  /** 분원 — 발송 액션에 전달. master 전체 모드에서는 빈 문자열. */
  branch: string;
  /** 환경변수 SMS_OPT_OUT_NUMBER — 광고 footer 미리보기에 표시. */
  optOutNumber: string;
}

export function SeminarComposeWizard({
  initialClassId,
  initialGroupId,
  classes,
  groups,
  branch,
  optOutNumber,
}: Props) {
  const [state, setState] = useState<SeminarComposeState>(() => ({
    selectedClassIds: initialClassId ? [initialClassId] : [],
    selectedGroupId: initialGroupId ?? "",
    type: "LMS",
    subject: "설명회 안내",
    body: buildDefaultBody(classes, initialClassId),
    isAd: false,
    allowMultiple: true,
  }));

  const selectedClasses = useMemo<ClassSignupOption[]>(
    () =>
      state.selectedClassIds
        .map((id) => classes.find((c) => c.class_id === id))
        .filter((v): v is ClassSignupOption => Boolean(v)),
    [classes, state.selectedClassIds],
  );

  const selectedGroup = useMemo<GroupListItem | null>(
    () => groups.find((g) => g.id === state.selectedGroupId) ?? null,
    [groups, state.selectedGroupId],
  );

  // 발송 활성 조건 — 미충족 항목 목록을 그대로 체크리스트로 노출.
  const missing: string[] = [];
  if (state.selectedClassIds.length === 0) missing.push("설명회 선택 (1개 이상)");
  if (!state.selectedGroupId) missing.push("대상 학생 그룹 선택");
  if (!state.body.trim()) missing.push("본문 작성");
  if (state.type === "LMS" && (!state.subject || state.subject.trim().length === 0)) {
    missing.push("LMS 제목 입력");
  }
  const readyToSend = missing.length === 0 && selectedGroup !== null;

  return (
    <div className="space-y-6">
      <Section index={1} title="설명회 선택">
        <SeminarComposeStep1Seminars
          classes={classes}
          selectedIds={state.selectedClassIds}
          allowMultiple={state.allowMultiple}
          onAllowMultipleChange={(next) =>
            setState((p) => ({ ...p, allowMultiple: next }))
          }
          onChange={(ids) =>
            setState((p) => ({
              ...p,
              selectedClassIds: ids,
              // 기본 본문에 첫 강좌 메타 반영(사용자가 본문을 직접 편집했으면 유지).
              body:
                p.body.trim().length === 0 ||
                p.body === buildDefaultBody(classes, null) ||
                p.body ===
                  buildDefaultBody(classes, p.selectedClassIds[0] ?? null)
                  ? buildDefaultBody(classes, ids[0] ?? null)
                  : p.body,
            }))
          }
        />
      </Section>

      <Section index={2} title="대상 학생 그룹">
        <SeminarComposeStep2Group
          groups={groups}
          groupId={state.selectedGroupId}
          onGroupIdChange={(id) =>
            setState((p) => ({ ...p, selectedGroupId: id }))
          }
        />
      </Section>

      <Section index={3} title="본문 작성">
        <SeminarComposeStep3Body
          state={state}
          onChange={(patch) => setState((p) => ({ ...p, ...patch }))}
          selectedClasses={selectedClasses}
          selectedGroup={selectedGroup}
          optOutNumber={optOutNumber}
        />
      </Section>

      <Section index={4} title="발송">
        {readyToSend && selectedGroup ? (
          <SeminarComposeStep4Send
            state={state}
            selectedClasses={selectedClasses}
            selectedGroup={selectedGroup}
            branch={branch}
            // 단일 페이지 폼이라 "본문으로 돌아가기" 의 별도 navigate 가 필요 없다.
            // 결과 카드의 dismiss 만 동작하도록 no-op 전달.
            onBackToBody={() => undefined}
          />
        ) : (
          <ReadinessChecklist missing={missing} />
        )}
      </Section>
    </div>
  );
}

// ─── 섹션 셸 ────────────────────────────────────────────────

function Section({
  index,
  title,
  children,
}: {
  index: 1 | 2 | 3 | 4;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={`${index}. ${title}`}
      className="rounded-xl border border-[color:var(--border)] bg-bg-card overflow-hidden"
    >
      <header className="flex items-center gap-3 px-5 py-3 border-b border-[color:var(--border)] bg-[color:var(--bg-muted)]">
        <span className="inline-flex items-center justify-center size-6 rounded-full bg-[color:var(--action)] text-[color:var(--action-text)] text-[12px] font-semibold tabular-nums">
          {index}
        </span>
        <h2 className="text-[15px] font-semibold text-[color:var(--text)]">
          {title}
        </h2>
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function ReadinessChecklist({ missing }: { missing: string[] }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border border-dashed border-[color:var(--border-strong)] bg-[color:var(--bg-muted)] p-4"
    >
      <AlertCircle
        className="size-4 mt-0.5 shrink-0 text-[color:var(--text-muted)]"
        strokeWidth={1.75}
        aria-hidden
      />
      <div className="text-[13px] text-[color:var(--text-muted)] space-y-1">
        <p>발송 전에 아래 항목을 채워주세요.</p>
        <ul className="list-disc pl-4 space-y-0.5">
          {missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─── 기본 본문 빌더 ──────────────────────────────────────────

/**
 * 선택된 강좌의 일시·장소를 자연어로 펼친 기본 본문.
 * 사용자가 본문을 직접 편집했으면 덮어쓰지 않는다 (Step1 onChange 분기 참고).
 */
function buildDefaultBody(
  classes: ClassSignupOption[],
  primaryId: string | null,
): string {
  const primary = primaryId
    ? classes.find((c) => c.class_id === primaryId) ?? null
    : null;

  const lines: string[] = ["[설명회 안내]"];
  if (primary) {
    lines.push(primary.class_name);
    if (primary.held_at) {
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
