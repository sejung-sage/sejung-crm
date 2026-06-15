"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type RefObject,
} from "react";
import {
  AlertTriangle,
  CalendarClock,
  Loader2,
  Megaphone,
  Moon,
  Phone,
  Send,
  Users,
} from "lucide-react";
import type { Grade, StudentStatus, TemplateRow } from "@/types/database";
import type { ClassOption } from "@/lib/classes/list-class-options";
import type { GroupFilters } from "@/lib/schemas/group";
import type { PreviewResult } from "@/lib/messaging/preview-recipients";
import {
  listMatchedRecipientsAction,
  previewAction,
  scheduleAction,
  sendNowAction,
  type MatchedRecipient,
} from "@/app/(features)/compose/actions";
import {
  FilterChipPanel,
  Field,
  SUBJECT_OPTIONS,
  type FilterChipValue,
  type FilterSubject,
} from "@/components/groups/filter-chip-panel";
import { PhonePreviewCard } from "@/components/messaging/phone-preview-card";
import { TestSendCard } from "@/components/messaging/test-send-card";
import { BRANCHES } from "@/config/branches";
import { formatPhone } from "@/lib/phone";
import { BYTE_LIMITS, type TemplateTypeLiteral } from "@/lib/schemas/template";
import { countEucKrBytes } from "@/lib/messaging/sms-bytes";
import {
  insertAdTag,
  insertAdSubjectTag,
  insertUnsubscribeFooter,
} from "@/lib/messaging/guards";
import { hasNameToken } from "@/lib/messaging/personalize";
import { ConfirmSendDialog } from "./confirm-send-dialog";
import {
  DedupeCountNote,
  extractDedupeCounts,
  shouldShowLegBreakdown,
} from "./dedupe-count-note";

/**
 * F3 · /compose 인라인 발송 (Aca2000 식 한 페이지 구성).
 *
 * 발송 그룹을 거치지 않고 한 화면에서:
 *  - 좌측: 문자 작성(유형/광고/제목/본문/미리보기 + 발송 옵션)
 *  - 우측: 필터 칩(공용 FilterChipPanel) + 매칭 학생 체크 목록
 *  - 하단: 대상 N명 · 예상 비용 + 발송 / 예약 발송
 *
 * 백엔드 계약(필터 기반):
 *  - listMatchedRecipientsAction({ filters, branch }) → 체크박스 명단
 *  - previewAction({ step1:{filters,branch}, step2 }) → 카운트·비용·가드 결과
 *  - sendNowAction / scheduleAction(ComposeFinal) → 발송
 *
 * 체크 해제한 학생 id 는 filters.excludeStudentIds 로 합쳐 미리보기·발송에 반영한다.
 */

const DEBOUNCE_MS = 300;
const SUBJECT_BYTE_LIMIT = 40;
const RECIPIENT_LIST_CAP = 300; // 화면에 그리는 상한(스크롤). 초과분은 "상위 일부" 안내.

const TYPE_OPTIONS: Array<{ value: TemplateTypeLiteral; label: string }> = [
  { value: "SMS", label: "SMS · 단문" },
  { value: "LMS", label: "LMS · 장문" },
];

const VARIABLE_TOKENS: Array<{ token: string; label: string }> = [
  { token: "{이름}", label: "{이름}" },
  { token: "{날짜}", label: "{날짜}" },
];

interface Step2State {
  templateId?: string;
  type: TemplateTypeLiteral;
  subject: string | null;
  body: string;
  isAd: boolean;
  dedupeByPhone: boolean;
  sendToParent: boolean;
  sendToStudent: boolean;
}

interface Props {
  branch: string;
  /** 분원 변경 가능 여부. master 만 true. */
  canPickBranch: boolean;
  schoolOptions: string[];
  classOptions: ClassOption[];
  availableGrades?: Grade[];
  availableRegions?: string[];
  templates: TemplateRow[];
  optOutNumber: string;
  /** dev-seed 모드면 명단 조회가 빈 배열을 반환하므로 안내문 노출. */
  devMode: boolean;
}

type SendUiResult =
  | { kind: "success"; campaignId: string }
  | { kind: "scheduled"; campaignId: string; scheduledAt: string }
  | { kind: "blocked"; reason: string }
  | { kind: "failed"; reason: string }
  | { kind: "dev_seed_mode"; reason: string };

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

export function ComposeInline({
  branch: initialBranch,
  canPickBranch,
  schoolOptions,
  classOptions,
  availableGrades,
  availableRegions,
  templates,
  optOutNumber,
  devMode,
}: Props) {
  const [branch, setBranch] = useState(initialBranch);
  const [chip, setChip] = useState<FilterChipValue>(emptyChipValue);
  // 체크 해제한 학생 id (= excludeStudentIds). 기본은 전부 체크(빈 집합).
  const [deselected, setDeselected] = useState<Set<string>>(new Set());

  const [step2, setStep2] = useState<Step2State>({
    templateId: undefined,
    type: "LMS",
    subject: null,
    body: "",
    isAd: false,
    dedupeByPhone: false,
    sendToParent: true,
    sendToStudent: false,
  });
  const [title, setTitle] = useState("");
  const [scheduleAt, setScheduleAt] = useState<string | null>(null);
  const [mode, setMode] = useState<"now" | "schedule">("now");

  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // ── 매칭 명단 ──
  const [recipients, setRecipients] = useState<MatchedRecipient[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const listDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listReqRef = useRef(0);

  // ── 미리보기 ──
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, startPreview] = useTransition();
  const [previewError, setPreviewError] = useState<string | null>(null);

  // ── 발송 ──
  const [result, setResult] = useState<SendUiResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, startSending] = useTransition();

  // 체크 해제 학생을 합친 최종 filters. 서버 계약(GroupFilters)에 맞춰 합성.
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
  // 않고(목록은 유지) 발송에서만 빼야 하므로, 명단 조회에는 deselected 를 넣지 않는다.
  const listFilters: GroupFilters = useMemo(
    () => ({ ...filters, excludeStudentIds: [] }),
    [filters],
  );

  // 매칭 명단 조회 — 칩/분원 변경 시 디바운스.
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
    // listFilters 는 chip/deselected 파생 — deselected 변화로 재조회하지 않도록
    // 의존성을 명시 필드로 좁힌다(체크 토글이 명단 재조회를 트리거하면 안 됨).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch, JSON.stringify(listFilters)]);

  // 미리보기 — 칩/분원/체크해제/발송옵션 변경 시 디바운스 트리거.
  useEffect(() => {
    if (!branch) return;
    const t = setTimeout(() => {
      setPreviewError(null);
      startPreview(async () => {
        const r = await previewAction({
          step1: { filters, branch },
          step2: {
            templateId: step2.templateId,
            type: step2.type,
            subject: step2.subject,
            body: step2.body,
            isAd: step2.isAd,
            dedupeByPhone: step2.dedupeByPhone,
            sendToParent: step2.sendToParent,
            sendToStudent: step2.sendToStudent,
          },
        });
        if (r.status === "success") {
          setPreview(r.data);
        } else {
          setPreviewError(r.reason);
          setPreview(null);
        }
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
    // body/subject 변경은 클라이언트 즉시 반영이라 트리거 제외(서버 재가공).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    branch,
    JSON.stringify(filters),
    step2.type,
    step2.isAd,
    step2.dedupeByPhone,
    step2.sendToParent,
    step2.sendToStudent,
  ]);

  // ── 본문 byte / 광고 가드 / 개인화 상호배타 ──
  const subjectBytes = useMemo(() => {
    const s = insertAdSubjectTag(step2.subject, step2.isAd);
    return s ? countEucKrBytes(s) : 0;
  }, [step2.subject, step2.isAd]);
  const subjectOverflow = subjectBytes > SUBJECT_BYTE_LIMIT;

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

  const bodyHasNameToken = useMemo(() => hasNameToken(step2.body), [step2.body]);
  useEffect(() => {
    if (bodyHasNameToken && step2.dedupeByPhone) {
      setStep2((s) => ({ ...s, dedupeByPhone: false }));
    }
  }, [bodyHasNameToken, step2.dedupeByPhone]);

  const bothTargets = step2.sendToParent && step2.sendToStudent;
  const [targetWarn, setTargetWarn] = useState<string | null>(null);

  const dedupeCounts = useMemo(() => extractDedupeCounts(preview), [preview]);
  const showBreakdown = useMemo(
    () => shouldShowLegBreakdown(dedupeCounts),
    [dedupeCounts],
  );

  const sampleValues = useMemo(() => {
    const name = preview?.sampleRecipients?.[0]?.name ?? "학생";
    const date = formatKstDateLabel(scheduleAt);
    return { name, date };
  }, [preview, scheduleAt]);

  const minScheduleAt = useMemo(
    () => toLocalDatetimeInput(new Date(Date.now() + 30 * 60_000)),
    [],
  );

  // ── 핸들러 ──
  const onTypeChange = (type: TemplateTypeLiteral) => {
    setStep2((s) => (type === "SMS" ? { ...s, type, subject: null } : { ...s, type }));
  };

  const toggleTarget = (which: "parent" | "student", next: boolean) => {
    if (next) {
      setTargetWarn(null);
      setStep2((s) => ({
        ...s,
        sendToParent: which === "parent" ? true : s.sendToParent,
        sendToStudent: which === "student" ? true : s.sendToStudent,
      }));
      return;
    }
    const wouldParent = which === "parent" ? false : step2.sendToParent;
    const wouldStudent = which === "student" ? false : step2.sendToStudent;
    if (!wouldParent && !wouldStudent) {
      setTargetWarn(
        "학부모·학생 중 최소 하나는 선택해야 합니다. 다른 대상을 먼저 선택하세요.",
      );
      return;
    }
    setTargetWarn(null);
    setStep2((s) => ({
      ...s,
      sendToParent: wouldParent,
      sendToStudent: wouldStudent,
    }));
  };

  const onPickTemplate = (id: string) => {
    if (!id) {
      setStep2((s) => ({ ...s, templateId: undefined }));
      return;
    }
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setStep2((s) => ({
      ...s,
      templateId: t.id,
      type: t.type,
      subject: t.subject,
      body: t.body,
      isAd: t.is_ad,
      dedupeByPhone: false,
    }));
  };

  const insertToken = (token: string) => {
    const ta = bodyRef.current;
    const current = step2.body;
    if (!ta) {
      setStep2((s) => ({ ...s, body: current + token }));
      return;
    }
    const start = ta.selectionStart ?? current.length;
    const end = ta.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    setStep2((s) => ({ ...s, body: next }));
    requestAnimationFrame(() => {
      const node = bodyRef.current;
      if (!node) return;
      const cursor = start + token.length;
      node.focus();
      node.setSelectionRange(cursor, cursor);
    });
  };

  const toggleRecipient = (studentId: string, checked: boolean) => {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (checked) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  const checkedCount = recipients.length - deselected.size;
  const allChecked = deselected.size === 0;
  const setAll = (checked: boolean) => {
    if (checked) {
      setDeselected(new Set());
    } else {
      setDeselected(new Set(recipients.map((r) => r.studentId)));
    }
  };

  const visibleRecipients = recipients.slice(0, RECIPIENT_LIST_CAP);
  const truncated = recipients.length > RECIPIENT_LIST_CAP;

  // 발송 가능 여부.
  const canSend =
    !!step2.body.trim() &&
    (step2.type === "SMS" || !!(step2.subject && step2.subject.trim())) &&
    !!title.trim() &&
    !!preview &&
    preview.recipientCount > 0 &&
    !preview.blockedByQuietHours &&
    !bodyOverflow &&
    !subjectOverflow &&
    (mode === "now" || !!scheduleAt);

  const openConfirm = () => {
    if (!canSend) return;
    setSendError(null);
    setResult(null);
    setConfirmOpen(true);
  };

  const confirmSend = () => {
    setConfirmOpen(false);
    setSendError(null);
    const step2Payload = {
      templateId: step2.templateId,
      type: step2.type,
      subject: step2.subject,
      body: step2.body,
      isAd: step2.isAd,
      dedupeByPhone: step2.dedupeByPhone,
      sendToParent: step2.sendToParent,
      sendToStudent: step2.sendToStudent,
    };
    startSending(async () => {
      if (mode === "now") {
        const r = await sendNowAction({
          step1: { filters, branch },
          step2: step2Payload,
          step3: { title: title.trim() },
        });
        setResult(toUiResult(r));
      } else {
        if (!scheduleAt) return;
        const iso = new Date(scheduleAt).toISOString();
        const r = await scheduleAction({
          step1: { filters, branch },
          step2: step2Payload,
          step3: { title: title.trim() },
          scheduleAt: iso,
        });
        setResult(toUiResult(r));
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* 분원 선택 */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[13px] font-medium text-[color:var(--text)]">
          발송 분원
        </span>
        <div className="flex gap-1.5">
          {BRANCHES.map((b) => {
            const active = branch === b;
            if (!canPickBranch && !active) return null;
            return (
              <button
                key={b}
                type="button"
                onClick={() => {
                  if (!canPickBranch || b === branch) return;
                  setBranch(b);
                  setDeselected(new Set());
                  setResult(null);
                }}
                aria-pressed={active}
                disabled={!canPickBranch}
                className={`inline-flex items-center h-9 px-3.5 rounded-full text-[14px] font-medium border transition-colors ${
                  active
                    ? "bg-[color:var(--action)] text-[color:var(--action-text)] border-[color:var(--action)]"
                    : "bg-bg-card text-[color:var(--text)] border-[color:var(--border)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--bg-hover)]"
                } disabled:cursor-default`}
              >
                {b}
              </button>
            );
          })}
        </div>
        {!canPickBranch && (
          <span className="text-[12px] text-[color:var(--text-dim)]">
            본인 분원으로 고정됩니다.
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* ── 좌측: 문자 작성 ── */}
        <div className="space-y-4">
          <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
            문자 작성
          </h2>

          {/* 템플릿 불러오기 */}
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
                className="w-full h-10 rounded-md px-2 bg-bg-card border border-[color:var(--border)] text-[14px] text-[color:var(--text)] focus:outline-none focus:border-[color:var(--border-strong)] cursor-pointer"
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
                    className={`flex items-center justify-center gap-1.5 h-10 rounded-md border cursor-pointer text-[14px] ${
                      checked
                        ? "border-[color:var(--action)] bg-[color:var(--bg-muted)] text-[color:var(--text)] font-medium"
                        : "border-[color:var(--border)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-hover)]"
                    }`}
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

          {/* 미리보기 (editable) */}
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
              setStep2((s) => ({ ...s, subject: next }))
            }
            onBodyChange={(next) => setStep2((s) => ({ ...s, body: next }))}
            bodyTextareaRef={bodyRef as RefObject<HTMLTextAreaElement>}
            footer={step2.isAd ? { unsubscribePhone: optOutNumber } : undefined}
            samples={sampleValues}
            recipientCount={preview?.recipientCount}
          />

          {step2.type !== "SMS" && (
            <p
              className={`text-[11px] tabular-nums text-right ${
                subjectOverflow
                  ? "text-[color:var(--danger)] font-medium"
                  : "text-[color:var(--text-dim)]"
              }`}
              aria-live="polite"
            >
              제목 {subjectBytes} / {SUBJECT_BYTE_LIMIT} 바이트
            </p>
          )}

          {bodyOverflow && (
            <p className="flex items-center gap-1.5 text-[12px] text-[color:var(--danger)]">
              <AlertTriangle className="size-3.5" strokeWidth={1.75} aria-hidden />
              현재 {step2.type} 한도({bodyLimit.toLocaleString()}바이트)를
              초과했습니다.
            </p>
          )}

          {/* 변수 삽입 */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[12px] text-[color:var(--text-muted)]">
              변수 삽입
            </span>
            {VARIABLE_TOKENS.map((v) => (
              <button
                key={v.token}
                type="button"
                onClick={() => insertToken(v.token)}
                className="inline-flex items-center justify-center h-8 px-3 rounded-full border border-[color:var(--border)] bg-bg-card text-[12px] text-[color:var(--text)] hover:bg-[color:var(--bg-hover)] focus:outline-none focus:ring-2 focus:ring-[color:var(--border-strong)] transition-colors"
                aria-label={`${v.label} 삽입`}
              >
                {v.label}
              </button>
            ))}
          </div>

          {/* 테스트 발송 */}
          <TestSendCard
            type={step2.type}
            subject={step2.subject ?? null}
            body={step2.body}
            isAd={step2.isAd}
            disabled={!step2.body.trim()}
          />

          {/* 발송 옵션 */}
          <fieldset className="space-y-2 rounded-lg border border-[color:var(--border)] p-4">
            <legend className="flex items-center gap-1.5 px-1 text-[12px] text-[color:var(--text-muted)]">
              <Phone className="size-3.5" strokeWidth={1.75} aria-hidden />
              발송 대상 번호
            </legend>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={step2.sendToParent}
                onChange={(e) => toggleTarget("parent", e.target.checked)}
                className="mt-0.5 size-4 accent-[color:var(--action)]"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-[14px] font-medium text-[color:var(--text)]">
                  학부모 번호
                </span>
                <span className="text-[11px] text-[color:var(--text-muted)]">
                  학부모 대표 연락처로 보냅니다.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={step2.sendToStudent}
                onChange={(e) => toggleTarget("student", e.target.checked)}
                className="mt-0.5 size-4 accent-[color:var(--action)]"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-[14px] font-medium text-[color:var(--text)]">
                  학생 번호
                </span>
                <span className="text-[11px] text-[color:var(--text-muted)]">
                  학생 개인 연락처로 보냅니다.
                </span>
              </span>
            </label>
            {targetWarn && (
              <p
                role="alert"
                className="flex items-start gap-1.5 text-[12px] leading-relaxed text-[color:var(--danger)]"
              >
                <AlertTriangle className="size-3.5 mt-0.5 shrink-0" strokeWidth={1.75} aria-hidden />
                {targetWarn}
              </p>
            )}
            {bothTargets && (
              <p className="flex items-start gap-2 text-[12px] leading-relaxed text-[color:var(--text-muted)]">
                <Users className="size-3.5 mt-0.5 shrink-0" strokeWidth={1.75} aria-hidden />
                학부모·학생 모두 선택하면 학생 1명당 최대 2건이 발송돼 문자비가
                늘어납니다. 번호가 없는 쪽은 자동으로 제외됩니다.
              </p>
            )}

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
                  setStep2((s) => ({ ...s, dedupeByPhone: e.target.checked }))
                }
                className="mt-0.5 size-4 accent-[color:var(--action)] disabled:cursor-not-allowed"
              />
              <span className="flex flex-col gap-0.5">
                <span
                  className={`text-[14px] font-medium ${
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
              <p className="flex items-start gap-2 text-[12px] leading-relaxed text-[color:var(--text-muted)]">
                <Users className="size-3.5 mt-0.5 shrink-0" strokeWidth={1.75} aria-hidden />
                {"{이름}"} 변수를 쓰면 같은 번호도 각각 보내야 해서 동일번호 1회
                발송을 사용할 수 없어요.
              </p>
            )}

            <label className="flex items-start gap-2 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={step2.isAd}
                onChange={(e) =>
                  setStep2((s) => ({ ...s, isAd: e.target.checked }))
                }
                className="mt-0.5 size-4 accent-[color:var(--action)]"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-[14px] font-medium text-[color:var(--text)]">
                  광고성 문자
                </span>
                <span className="text-[11px] text-[color:var(--text-muted)]">
                  체크 시 [광고] 머리말 + 080 수신거부가 자동 삽입됩니다.
                </span>
              </span>
            </label>
            {step2.isAd && (
              <p className="flex items-start gap-2 text-[12px] leading-relaxed text-[color:var(--warning)]">
                <Megaphone className="size-3.5 mt-0.5 shrink-0" strokeWidth={1.75} aria-hidden />
                21시 ~ 08시 광고 발송이 차단됩니다.
              </p>
            )}
          </fieldset>

          {/* 캠페인 제목 */}
          <div className="space-y-1.5">
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
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 4월 정기 안내"
              maxLength={60}
              className="w-full h-10 rounded-lg px-3 bg-bg-card border border-[color:var(--border)] text-[15px] text-[color:var(--text)] placeholder:text-[color:var(--text-dim)] focus:outline-none focus:border-[color:var(--border-strong)]"
            />
          </div>
        </div>

        {/* ── 우측: 대상 ── */}
        <div className="space-y-4">
          <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
            발송 대상
          </h2>

          <FilterChipPanel
            value={chip}
            onChange={setChip}
            branch={branch}
            schoolOptions={schoolOptions}
            classOptions={classOptions}
            availableGrades={availableGrades}
            availableRegions={availableRegions}
          />

          {/* 매칭 학생 목록 */}
          <Field
            label="매칭 학생"
            hint={
              listLoading
                ? "불러오는 중..."
                : `${recipients.length.toLocaleString()}명 중 ${checkedCount.toLocaleString()}명 선택`
            }
          >
            <div className="rounded-lg border border-[color:var(--border)] bg-bg-card">
              <div className="flex items-center justify-between gap-2 px-3 h-10 border-b border-[color:var(--border)]">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={recipients.length > 0 && allChecked}
                    ref={(el) => {
                      if (el)
                        el.indeterminate =
                          !allChecked && checkedCount > 0;
                    }}
                    onChange={(e) => setAll(e.target.checked)}
                    disabled={recipients.length === 0}
                    className="size-4 accent-[color:var(--action)]"
                  />
                  <span className="text-[13px] text-[color:var(--text)]">
                    전체 선택
                  </span>
                </label>
                {listLoading && (
                  <span className="inline-flex items-center gap-1.5 text-[12px] text-[color:var(--text-muted)]">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    계산 중...
                  </span>
                )}
              </div>

              {listError && (
                <p
                  role="alert"
                  className="px-3 py-3 text-[13px] text-[color:var(--danger)]"
                >
                  {listError}
                </p>
              )}

              {!listError && recipients.length === 0 && !listLoading && (
                <p className="px-3 py-6 text-[13px] text-[color:var(--text-muted)] text-center">
                  {devMode
                    ? "개발 시드 모드에서는 매칭 명단이 표시되지 않습니다. 인원수·비용 미리보기는 동작합니다."
                    : "조건에 맞는 학생이 없습니다. 위 필터를 조정해 주세요."}
                </p>
              )}

              {visibleRecipients.length > 0 && (
                <ul className="max-h-80 overflow-auto divide-y divide-[color:var(--border)]">
                  {visibleRecipients.map((r) => {
                    const checked = !deselected.has(r.studentId);
                    const phone = r.parentPhone || r.studentPhone;
                    return (
                      <li key={r.studentId}>
                        <label className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-[color:var(--bg-hover)]">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              toggleRecipient(r.studentId, e.target.checked)
                            }
                            className="size-4 accent-[color:var(--action)]"
                          />
                          <span className="text-[14px] font-medium text-[color:var(--text)]">
                            {r.name}
                          </span>
                          <span className="text-[13px] tabular-nums text-[color:var(--text-muted)] ml-auto">
                            {phone ? formatPhone(phone) || phone : "번호 없음"}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}

              {truncated && (
                <p className="px-3 py-2 text-[12px] text-[color:var(--text-dim)] border-t border-[color:var(--border)]">
                  전체 {recipients.length.toLocaleString()}명 중 상위{" "}
                  {RECIPIENT_LIST_CAP.toLocaleString()}명만 목록에 표시됩니다.
                  체크 해제는 표시된 학생에만 적용됩니다.
                </p>
              )}
            </div>
          </Field>

          <p className="text-[12px] text-[color:var(--text-dim)] leading-relaxed">
            비활성(탈퇴) · 수신거부 학생은 발송 시 자동 제외됩니다.
          </p>
        </div>
      </div>

      {/* ── 하단 발송 바 ── */}
      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-muted)] p-5 space-y-4">
        {previewError && (
          <div
            role="alert"
            className="rounded-lg border border-[color:var(--danger)] bg-[color:var(--danger-bg)] px-4 py-3 text-[14px] text-[color:var(--danger)]"
          >
            {previewError}
          </div>
        )}

        {preview?.blockedByQuietHours && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-[color:var(--danger)] bg-[color:var(--danger-bg)] px-4 py-3"
          >
            <Moon className="size-4 mt-0.5 text-[color:var(--danger)]" strokeWidth={1.75} aria-hidden />
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

        {/* 발송 시점 */}
        <fieldset className="flex flex-wrap items-center gap-3">
          <legend className="sr-only">발송 시점</legend>
          <label className="flex items-center gap-2 cursor-pointer text-[14px] text-[color:var(--text)]">
            <input
              type="radio"
              name="compose-when"
              checked={mode === "now"}
              onChange={() => {
                setMode("now");
                setScheduleAt(null);
                setResult(null);
              }}
              className="size-4 accent-[color:var(--action)]"
            />
            즉시 발송
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-[14px] text-[color:var(--text)]">
            <input
              type="radio"
              name="compose-when"
              checked={mode === "schedule"}
              onChange={() => {
                setMode("schedule");
                setResult(null);
              }}
              className="size-4 accent-[color:var(--action)]"
            />
            예약 발송
          </label>
          {mode === "schedule" && (
            <input
              type="datetime-local"
              value={scheduleAt ?? ""}
              min={minScheduleAt}
              onChange={(e) => setScheduleAt(e.target.value || null)}
              aria-label="예약 시각"
              className="h-10 rounded-lg px-3 bg-bg-card border border-[color:var(--border)] text-[15px] text-[color:var(--text)] focus:outline-none focus:border-[color:var(--border-strong)]"
            />
          )}
        </fieldset>

        {mode === "schedule" && (
          <p className="flex items-start gap-1.5 text-[12px] text-[color:var(--text-muted)]">
            <CalendarClock className="size-3.5 mt-0.5 shrink-0" strokeWidth={1.75} aria-hidden />
            최소 30분 이후로 예약할 수 있고, 발송 약 10분 전까지 캠페인 상세에서
            취소할 수 있어요.
          </p>
        )}

        <DedupeCountNote counts={dedupeCounts} variant="card" />

        {result && <ResultBox result={result} />}

        {sendError && (
          <div
            role="alert"
            className="rounded-lg border border-[color:var(--danger)] bg-[color:var(--danger-bg)] px-4 py-3 text-[14px] text-[color:var(--danger)]"
          >
            {sendError}
          </div>
        )}

        {!result && (
          <div className="flex items-center justify-between gap-4 flex-wrap pt-1">
            <div className="text-[15px] text-[color:var(--text)]">
              발송 대상{" "}
              <strong className="tabular-nums text-[18px]">
                {showBreakdown && dedupeCounts
                  ? `${dedupeCounts.actualMessages.toLocaleString("ko-KR")}건`
                  : `${(preview?.recipientCount ?? 0).toLocaleString("ko-KR")}명`}
              </strong>
              {preview && (
                <span className="ml-3 text-[14px] text-[color:var(--text-muted)] tabular-nums">
                  예상 비용 {preview.cost.totalCost.toLocaleString("ko-KR")}원
                </span>
              )}
              {previewLoading && (
                <Loader2 className="inline ml-2 size-4 animate-spin text-[color:var(--text-muted)]" aria-hidden />
              )}
            </div>
            <button
              type="button"
              onClick={openConfirm}
              disabled={!canSend || isSending}
              className="inline-flex items-center gap-1.5 h-11 px-6 rounded-lg bg-[color:var(--action)] text-[color:var(--action-text)] text-[15px] font-medium hover:bg-[color:var(--action-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="size-4" strokeWidth={1.75} aria-hidden />
              {isSending
                ? "처리 중..."
                : mode === "now"
                  ? "지금 발송"
                  : "예약 등록"}
            </button>
          </div>
        )}
      </div>

      {confirmOpen && preview && (
        <ConfirmSendDialog
          mode={mode}
          scheduleAt={scheduleAt}
          recipientCount={preview.recipientCount}
          dedupe={dedupeCounts}
          cost={preview.cost.totalCost}
          messageBody={step2.body}
          title={title.trim()}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={confirmSend}
        />
      )}
    </div>
  );
}

// ─── 결과 박스 ───────────────────────────────────────────────

function ResultBox({ result }: { result: SendUiResult }) {
  if (result.kind === "success") {
    return (
      <div
        role="status"
        className="rounded-lg border border-[color:var(--success)] bg-[color:var(--success-bg)] p-4 space-y-2"
      >
        <p className="text-[14px] font-medium text-[color:var(--text)]">
          발송이 완료되었습니다.
        </p>
        <Link
          href={`/campaigns/${result.campaignId}`}
          className="inline-flex items-center h-10 px-4 rounded-lg bg-[color:var(--action)] text-[color:var(--action-text)] text-[14px] font-medium hover:bg-[color:var(--action-hover)] transition-colors"
        >
          캠페인 보기
        </Link>
      </div>
    );
  }
  if (result.kind === "scheduled") {
    return (
      <div
        role="status"
        className="rounded-lg border border-[color:var(--success)] bg-[color:var(--success-bg)] p-4 space-y-2"
      >
        <p className="text-[14px] font-medium text-[color:var(--text)]">
          예약이 등록되었습니다.
        </p>
        <p className="text-[13px] text-[color:var(--text-muted)]">
          예약 시각: {formatScheduleDisplay(result.scheduledAt)}
        </p>
        <Link
          href={`/campaigns/${result.campaignId}`}
          className="inline-flex items-center h-10 px-4 rounded-lg bg-[color:var(--action)] text-[color:var(--action-text)] text-[14px] font-medium hover:bg-[color:var(--action-hover)] transition-colors"
        >
          캠페인 보기
        </Link>
      </div>
    );
  }
  if (result.kind === "blocked") {
    return (
      <div
        role="alert"
        className="rounded-lg border border-[color:var(--danger)] bg-[color:var(--danger-bg)] p-4 space-y-1"
      >
        <p className="text-[14px] font-medium text-[color:var(--danger)]">
          발송이 차단되었습니다.
        </p>
        <p className="text-[13px] text-[color:var(--text)]">{result.reason}</p>
      </div>
    );
  }
  if (result.kind === "failed") {
    return (
      <div
        role="alert"
        className="rounded-lg border border-[color:var(--danger)] bg-[color:var(--danger-bg)] p-4 space-y-1"
      >
        <p className="text-[14px] font-medium text-[color:var(--danger)]">
          발송에 실패했습니다.
        </p>
        <p className="text-[13px] text-[color:var(--text)]">{result.reason}</p>
      </div>
    );
  }
  return (
    <div
      role="status"
      className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] p-4 text-[13px] text-[color:var(--text-muted)]"
    >
      {result.reason}
    </div>
  );
}

// ─── 헬퍼 ────────────────────────────────────────────────────

import type { SendCampaignResult } from "@/lib/messaging/send-campaign";

function toUiResult(r: SendCampaignResult): SendUiResult {
  switch (r.status) {
    case "success":
      return { kind: "success", campaignId: r.campaignId };
    case "scheduled":
      return {
        kind: "scheduled",
        campaignId: r.campaignId,
        scheduledAt: r.scheduledAt,
      };
    case "blocked":
      return { kind: "blocked", reason: r.reason };
    case "failed":
      return { kind: "failed", reason: r.reason };
    case "dev_seed_mode":
      return { kind: "dev_seed_mode", reason: r.reason };
  }
}

function toLocalDatetimeInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatScheduleDisplay(input: string): string {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return input;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatKstDateLabel(scheduleAt: string | null): string {
  let target: Date;
  if (scheduleAt) {
    const parsed = new Date(scheduleAt);
    target = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  } else {
    target = new Date();
  }
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
  }).format(target);
}
