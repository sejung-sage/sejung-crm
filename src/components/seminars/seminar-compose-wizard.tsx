"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import type { ClassSignupOption, Grade } from "@/types/database";
import type { ClassOption } from "@/lib/classes/list-class-options";
import type { GroupFilters } from "@/lib/schemas/group";
import {
  listMatchedRecipientsAction,
  type MatchedRecipient,
} from "@/app/(features)/compose/actions";
import {
  SUBJECT_OPTIONS,
  type FilterChipValue,
  type FilterSubject,
} from "@/components/groups/filter-chip-panel";
import { SeminarComposeStep1Seminars } from "./seminar-compose-step-1-seminars";
import { SeminarComposeStep2Target } from "./seminar-compose-step-2-target";
import { SeminarComposeStep3Body } from "./seminar-compose-step-3-body";
import { SeminarComposeStep4Send } from "./seminar-compose-step-4-send";

/**
 * F5 · 설명회 문자 발송 — 단일 페이지 폼 (0084/0085 새 모델).
 *
 * 2026-06-15 개편: 옛 "발송 그룹 선택" 단계를 제거하고, 일반 SMS /compose 와
 * 동일한 인라인 필터 칩 + 매칭 학생 체크 목록으로 교체. group_id 의존을 버리고
 * backend `createSeminarBroadcastAction(filters, branch)` 경로를 그대로 쓴다.
 *
 * 섹션:
 *   1. 설명회 선택 (다중)            — selectedClassIds (검색·월 필터·다중 선택)
 *   2. 대상 학생 (필터)              — chip + 매칭 명단 체크(해제분 = excludeStudentIds)
 *   3. 본문 작성 (SMS/LMS)            — type / subject / body / isAd / {초대링크}
 *   4. 발송                            — 즉시/예약 + 중복신청 허용 토글 (조건 충족 후 활성)
 */

export type SmsType = "SMS" | "LMS";

export interface SeminarComposeState {
  /** 선택된 강좌(=설명회) id 배열. 0084 새 모델 — 옛 seminar id 아님. */
  selectedClassIds: string[];
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
  classes: ClassSignupOption[];
  /** 분원 — 발송 액션·필터 조회에 전달. */
  branch: string;
  /** 필터 칩 — 학교 토글 후보(서버 prefetch). */
  schoolOptions: string[];
  /** 필터 칩 — 강좌별 제외 드롭다운 후보(서버 prefetch). */
  classOptions: ClassOption[];
  /** 분원 매칭 학생이 있는 학년 set. */
  availableGrades?: Grade[];
  /** 분원 매칭 학생이 있는 지역 set. */
  availableRegions?: string[];
  /** dev-seed 모드면 매칭 명단이 빈 배열이라 안내문 노출. */
  devMode: boolean;
  /** 환경변수 SMS_OPT_OUT_NUMBER — 광고 footer 미리보기에 표시. */
  optOutNumber: string;
}

const DEBOUNCE_MS = 300;

function emptyChipValue(): FilterChipValue {
  return {
    grades: [],
    schools: [],
    subjects: [],
    regions: [],
    statuses: [],
    excludeSchools: [],
    excludeClasses: [],
    unmappedSchool: false,
    mappedSchool: false,
  };
}

export function SeminarComposeWizard({
  initialClassId,
  classes,
  branch,
  schoolOptions,
  classOptions,
  availableGrades,
  availableRegions,
  devMode,
  optOutNumber,
}: Props) {
  const [state, setState] = useState<SeminarComposeState>(() => ({
    selectedClassIds: initialClassId ? [initialClassId] : [],
    type: "LMS",
    subject: "설명회 안내",
    body: buildDefaultBody(classes, initialClassId),
    isAd: false,
    allowMultiple: true,
  }));

  // ── 대상(필터) 상태 ──
  const [chip, setChip] = useState<FilterChipValue>(emptyChipValue);
  // 체크 해제한 학생 id (= excludeStudentIds). 기본은 전부 체크(빈 집합).
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [recipients, setRecipients] = useState<MatchedRecipient[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const listDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listReqRef = useRef(0);

  const selectedClasses = useMemo<ClassSignupOption[]>(
    () =>
      state.selectedClassIds
        .map((id) => classes.find((c) => c.class_id === id))
        .filter((v): v is ClassSignupOption => Boolean(v)),
    [classes, state.selectedClassIds],
  );

  // 체크 해제 학생을 합친 최종 filters — 서버 계약(GroupFilters)에 맞춰 합성.
  const filters: GroupFilters = useMemo(() => {
    return {
      kind: "filter",
      grades: chip.grades,
      schools: chip.schools,
      subjects: chip.subjects.filter((s): s is FilterSubject =>
        (SUBJECT_OPTIONS as readonly string[]).includes(s),
      ),
      regions: chip.regions,
      statuses: chip.statuses,
      includeStudentIds: [],
      excludeStudentIds: Array.from(deselected),
      excludeSchools: chip.excludeSchools,
      excludeClassIds: chip.excludeClasses.map((c) => c.id),
      unmappedSchool: chip.unmappedSchool,
      mappedSchool: chip.mappedSchool,
    };
  }, [chip, deselected]);

  // 칩만으로 만든 filters(체크 해제 제외) — 명단 조회용. 체크 해제는 명단을 줄이지
  // 않고(목록 유지) 발송에서만 빼야 하므로 명단 조회에는 deselected 를 넣지 않는다.
  const listFilters: GroupFilters = useMemo(
    () => ({ ...filters, excludeStudentIds: [] }),
    [filters],
  );

  // 매칭 명단 조회 — 칩 변경 시 디바운스.
  useEffect(() => {
    if (!branch) return;
    if (listDebounceRef.current) clearTimeout(listDebounceRef.current);
    setListLoading(true);
    setListError(null);
    listDebounceRef.current = setTimeout(async () => {
      const myReq = ++listReqRef.current;
      const r = await listMatchedRecipientsAction({
        filters: listFilters,
        branch,
      });
      if (myReq !== listReqRef.current) return;
      if (r.status === "success") {
        setRecipients(r.recipients);
        // 새 명단에 없는 체크 해제 id 는 정리(stale 제거).
        setDeselected((prev) => {
          if (prev.size === 0) return prev;
          const ids = new Set(r.recipients.map((x) => x.studentId));
          const next = new Set<string>();
          for (const id of prev) if (ids.has(id)) next.add(id);
          return next;
        });
      } else {
        setListError(r.reason);
        setRecipients([]);
      }
      setListLoading(false);
    }, DEBOUNCE_MS);
    return () => {
      if (listDebounceRef.current) clearTimeout(listDebounceRef.current);
    };
    // listFilters 는 chip 파생 — 체크 토글(deselected)이 재조회를 트리거하지
    // 않도록 의존성을 명시 필드(JSON)로 좁힌다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch, JSON.stringify(listFilters)]);

  const toggleRecipient = (studentId: string, checked: boolean) => {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (checked) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  const setAll = (checked: boolean) => {
    if (checked) setDeselected(new Set());
    else setDeselected(new Set(recipients.map((r) => r.studentId)));
  };

  const checkedCount = recipients.length - deselected.size;

  // 발송 활성 조건 — 미충족 항목 목록을 그대로 체크리스트로 노출.
  const missing: string[] = [];
  if (state.selectedClassIds.length === 0) missing.push("설명회 선택 (1개 이상)");
  if (checkedCount <= 0) missing.push("대상 학생 선택 (1명 이상)");
  if (!state.body.trim()) missing.push("본문 작성");
  if (
    state.type === "LMS" &&
    (!state.subject || state.subject.trim().length === 0)
  ) {
    missing.push("LMS 제목 입력");
  }
  const readyToSend = missing.length === 0;

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

      <Section index={2} title="대상 학생">
        <SeminarComposeStep2Target
          chip={chip}
          onChipChange={setChip}
          branch={branch}
          schoolOptions={schoolOptions}
          classOptions={classOptions}
          availableGrades={availableGrades}
          availableRegions={availableRegions}
          recipients={recipients}
          deselected={deselected}
          onToggleRecipient={toggleRecipient}
          onSetAll={setAll}
          listLoading={listLoading}
          listError={listError}
          devMode={devMode}
        />
      </Section>

      <Section index={3} title="본문 작성">
        <SeminarComposeStep3Body
          state={state}
          onChange={(patch) => setState((p) => ({ ...p, ...patch }))}
          selectedClasses={selectedClasses}
          recipientCount={checkedCount}
          optOutNumber={optOutNumber}
        />
      </Section>

      <Section index={4} title="발송">
        {readyToSend ? (
          <SeminarComposeStep4Send
            state={state}
            selectedClasses={selectedClasses}
            filters={filters}
            recipientCount={checkedCount}
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
