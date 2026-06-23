"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  AlertTriangle,
  CalendarClock,
  Loader2,
  Phone,
  Send,
  Users,
} from "lucide-react";
import type { Grade, StudentStatus, TemplateRow } from "@/types/database";
import type { ClassOption } from "@/lib/classes/list-class-options";
import type { GroupFilters } from "@/lib/schemas/group";
import { isEmptyFilterCohort } from "@/lib/schemas/group";
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
import { VirtualRecipientList } from "@/components/messaging/virtual-recipient-list";
import { TestSendCard } from "@/components/messaging/test-send-card";
import { BYTE_LIMITS, type TemplateTypeLiteral } from "@/lib/schemas/template";
import { countEucKrBytes } from "@/lib/messaging/sms-bytes";
import {
  insertSenderHeader,
  insertAdSubjectTag,
  insertUnsubscribeFooter,
  branchBrandName,
} from "@/lib/messaging/guards";
import { hasNameToken } from "@/lib/messaging/personalize";
import { deriveCampaignTitle } from "@/lib/messaging/derive-campaign-title";
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

const TYPE_OPTIONS: Array<{ value: TemplateTypeLiteral; label: string }> = [
  { value: "SMS", label: "SMS · 단문" },
  { value: "LMS", label: "LMS · 장문" },
];

const VARIABLE_TOKENS: Array<{ token: string; label: string }> = [
  { token: "{이름}", label: "{이름}" },
  { token: "{날짜}", label: "{날짜}" },
];

const INPUT_CLASS = `
  w-full h-11 rounded-lg px-3
  bg-bg-card border border-[color:var(--border)]
  text-[15px] text-[color:var(--text)]
  placeholder:text-[color:var(--text-dim)]
  focus:outline-none focus:border-[color:var(--border-strong)]
  transition-colors
`;

const TEXTAREA_CLASS = `
  w-full rounded-lg px-3 py-2.5 resize-none overflow-auto min-h-[10rem]
  bg-bg-card border border-[color:var(--border)]
  text-[15px] leading-relaxed text-[color:var(--text)]
  placeholder:text-[color:var(--text-dim)]
  focus:outline-none focus:border-[color:var(--border-strong)]
  transition-colors
`;

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
  /**
   * 분원 변경 가능 여부(master). 분원 변경은 좌측 상단 사이드바에서 하므로
   * 이 컴포넌트에서는 사용하지 않지만, 호출부 계약 유지를 위해 prop 은 받는다.
   */
  canPickBranch?: boolean;
  /**
   * 진입 prefill 초기 필터(서버에서 학생/강좌/회차를 학생 id 로 해석한 결과).
   * kind='custom' + includeStudentIds 면 그 학생들로 시작(우측 명단·체크가 채워짐).
   * 미지정/kind='filter' 면 빈 조건으로 시작(기존 동작).
   */
  initialFilters?: GroupFilters;
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
  initialFilters,
  schoolOptions,
  classOptions,
  availableGrades,
  availableRegions,
  templates,
  optOutNumber,
  devMode,
}: Props) {
  const branch = initialBranch;
  const [chip, setChip] = useState<FilterChipValue>(emptyChipValue);
  // 선택 모드 — 매칭 명단 체크박스의 두 가지 의미.
  //  - "exclude"(기본): 전원 선택 상태에서 일부를 빼는 방식. deselected = 뺀 학생.
  //  - "include": 아무도 선택 안 된 상태에서 고른 소수만 보내는 방식. included = 고른 학생.
  // "전체 해제"를 누르면 include 로 전환한다. 코호트가 표시 상한(1만)을 넘을 때
  // exclude 로 "전체 해제"하면 표시분(1만)만 빠지고 나머지는 선택으로 남아(의도와 다름)
  // + 1만 개 제외 id 가 쿼리에 실려 414 가 났기 때문(2026-06-22 수정).
  const [selectMode, setSelectMode] = useState<"exclude" | "include">(
    "exclude",
  );
  // exclude 모드에서 체크 해제한 학생 id (= excludeStudentIds). 기본 빈 집합(전원 선택).
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  // include 모드에서 체크한 학생 id (= includeStudentIds, custom 명단). 기본 빈 집합.
  const [included, setIncluded] = useState<Set<string>>(new Set());

  // 진입 prefill 이 custom(고정 명단)이면 그 학생 id 들을 모집단으로 고정한다.
  // 사용자가 우측 필터 칩을 건드리면 'filter'(조건) 모드로 전환한다 — 그때부턴
  // 칩 조건이 모집단을 결정. (prefill 없으면 처음부터 'filter' 모드.)
  const [customStudentIds] = useState<string[]>(() =>
    initialFilters?.kind === "custom" ? initialFilters.includeStudentIds : [],
  );
  const [useCustom, setUseCustom] = useState(
    () => (initialFilters?.kind === "custom" ? customStudentIds.length > 0 : false),
  );

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
  const [scheduleAt, setScheduleAt] = useState<string | null>(null);
  const [mode, setMode] = useState<"now" | "schedule">("now");

  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // 캠페인 제목(내부 관리용)은 입력칸 없이 본문 앞부분으로 자동 생성한다(2026-06-23).
  const title = useMemo(() => deriveCampaignTitle(step2.body), [step2.body]);

  // ── 매칭 명단 ──
  // recipients: 표시용 상위 일부(서버가 캡). total: 전체 매칭 수(head 카운트).
  const [recipients, setRecipients] = useState<MatchedRecipient[]>([]);
  const [total, setTotal] = useState(0);
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

  // 발송에 쓰는 최종 filters. 서버 계약(GroupFilters)에 맞춰 합성. 선택 모드별로 다름:
  //  - include 모드: 고른 소수만(custom 명단). includeStudentIds = included.
  //    ("전체 해제 후 몇 명" — 칩 조건 무시, 고른 학생들만 발송.)
  //  - exclude + useCustom: prefill 고정 명단(customStudentIds) 모집단 − 체크 해제분.
  //  - exclude + 칩: 칩 조건 모집단('filter') − 체크 해제분.
  const filters: GroupFilters = useMemo(() => {
    if (selectMode === "include") {
      return {
        kind: "custom",
        grades: [],
        schools: [],
        subjects: [],
        regions: [],
        statuses: [],
        includeStudentIds: Array.from(included),
        excludeStudentIds: [],
        excludeSchools: [],
        excludeClassIds: [],
        unmappedSchool: false,
        mappedSchool: false,
      };
    }
    if (useCustom) {
      return {
        kind: "custom",
        grades: [],
        schools: [],
        subjects: [],
        regions: [],
        statuses: [],
        includeStudentIds: customStudentIds,
        excludeStudentIds: Array.from(deselected),
        excludeSchools: [],
        excludeClassIds: [],
        unmappedSchool: false,
        mappedSchool: false,
      };
    }
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
  }, [selectMode, included, useCustom, customStudentIds, chip, deselected]);

  // 매칭 명단(우측 패널) 조회용 filters — 선택 모드와 무관하게 항상 "칩 조건(또는 prefill
  // custom)" 코호트를 보여준다. 사용자가 그 안에서 고르거나(include) 빼야(exclude) 하므로
  // 명단은 선택 상태(deselected/included)에 따라 줄어들면 안 된다.
  const listFilters: GroupFilters = useMemo(() => {
    if (useCustom) {
      return {
        kind: "custom",
        grades: [],
        schools: [],
        subjects: [],
        regions: [],
        statuses: [],
        includeStudentIds: customStudentIds,
        excludeStudentIds: [],
        excludeSchools: [],
        excludeClassIds: [],
        unmappedSchool: false,
        mappedSchool: false,
      };
    }
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
      excludeStudentIds: [],
      excludeSchools: chip.excludeSchools,
      excludeClassIds: chip.excludeClasses.map((c) => c.id),
      unmappedSchool: chip.unmappedSchool,
      mappedSchool: chip.mappedSchool,
    };
  }, [useCustom, customStudentIds, chip]);

  // 매칭 명단 조회 — 칩/분원 변경 시 디바운스.
  useEffect(() => {
    if (!branch) return;
    if (listDebounceRef.current) clearTimeout(listDebounceRef.current);
    // 조건이 하나도 없으면(분원 전원) 명단을 자동 로드하지 않는다 — 분원 최대 ~6.4만 명을
    // 매번 직렬화하면 느리고(~1.3초), 그 조회 중 필터를 바꾸면 응답이 뒤늦게 도착해
    // 렉이 걸린다. 인원/비용은 가벼운 미리보기(카운트)로 보여주고, 명단(체크 목록)은
    // 학년·학교 등 조건을 고른 뒤에만 그린다.
    if (isEmptyFilterCohort(listFilters)) {
      listReqRef.current += 1; // 진행 중이던 직전 요청 결과 무시
      setRecipients([]);
      setTotal(0);
      setListLoading(false);
      setListError(null);
      return;
    }
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
        setTotal(r.total);
        // 새 명단에 없는 체크 해제/포함 id 는 정리(stale 제거).
        const ids = new Set(r.recipients.map((x) => x.studentId));
        const prune = (prev: Set<string>) => {
          if (prev.size === 0) return prev;
          const next = new Set<string>();
          for (const id of prev) if (ids.has(id)) next.add(id);
          return next.size === prev.size ? prev : next;
        };
        setDeselected(prune);
        setIncluded(prune);
      } else {
        setListError(r.reason);
        setRecipients([]);
        setTotal(0);
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

  const brandName = useMemo(() => branchBrandName(branch), [branch]);
  const clientFinalBody = useMemo(() => {
    const withHeader = insertSenderHeader(step2.body, step2.isAd, brandName);
    return insertUnsubscribeFooter(withHeader, step2.isAd, optOutNumber);
  }, [step2.body, step2.isAd, optOutNumber, brandName]);
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

  // 미리보기 본문 — 브랜드 머리(+광고)는 insertSenderHeader 로 반영, {이름}·{날짜}는
  // 예시값으로 치환. footer(무료 수신거부)는 PhonePreviewCard 가 따로 렌더한다.
  const previewBody = useMemo(() => {
    const guarded = insertSenderHeader(step2.body, step2.isAd, brandName);
    return guarded
      .split("{이름}")
      .join(sampleValues.name)
      .split("{날짜}")
      .join(sampleValues.date);
  }, [step2.body, step2.isAd, brandName, sampleValues]);

  // 미리보기 제목 — LMS 면 {이름}·{날짜} 치환, SMS 면 제목 없음.
  const previewSubject = useMemo(() => {
    if (step2.type !== "LMS") return null;
    return (step2.subject ?? "")
      .split("{이름}")
      .join(sampleValues.name)
      .split("{날짜}")
      .join(sampleValues.date);
  }, [step2.type, step2.subject, sampleValues]);

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
    if (selectMode === "include") {
      // 포함 모드: 체크 = 발송 대상에 추가.
      setIncluded((prev) => {
        const next = new Set(prev);
        if (checked) next.add(studentId);
        else next.delete(studentId);
        return next;
      });
    } else {
      // 제외 모드: 체크 해제 = 발송에서 뺌.
      setDeselected((prev) => {
        const next = new Set(prev);
        if (checked) next.delete(studentId);
        else next.add(studentId);
        return next;
      });
    }
  };

  const isRecipientChecked = (studentId: string) =>
    selectMode === "include"
      ? included.has(studentId)
      : !deselected.has(studentId);

  // 조건이 없으면(분원 전원) 명단을 자동 로드하지 않으므로 total 은 0 이다. 이때 인원수는
  // 가벼운 미리보기 카운트로 보여준다(발송은 전원 그대로 진행).
  const noFilterCohort = isEmptyFilterCohort(listFilters);
  const effectiveTotal = noFilterCohort ? preview?.recipientCount ?? 0 : total;

  // 선택 수 — 모드별. include: 고른 수. exclude: 전체 매칭 − 표시분에서 해제한 수.
  const checkedCount =
    selectMode === "include"
      ? included.size
      : effectiveTotal - deselected.size;
  // 헤더 체크박스 상태.
  const allChecked = selectMode === "exclude" && deselected.size === 0;
  const headerIndeterminate =
    selectMode === "include" ? included.size > 0 : deselected.size > 0;
  const setAll = (checked: boolean) => {
    if (checked) {
      // 전체 선택 → 제외 모드 + 해제 없음(전원 선택).
      setSelectMode("exclude");
      setDeselected(new Set());
      setIncluded(new Set());
    } else {
      // 전체 해제 → 포함 모드 + 아무도 선택 안 됨. (표시분 1만만 빠지던 버그 + 414 회피.)
      setSelectMode("include");
      setIncluded(new Set());
      setDeselected(new Set());
    }
  };

  // 서버가 상한(MATCHED_LIST_CAP)까지 이름순으로 전원 내려줌 — 전부 렌더.
  const visibleRecipients = recipients;
  const truncated = total > recipients.length;

  // 발송 가능 여부.
  const canSend =
    !!step2.body.trim() &&
    (step2.type === "SMS" || !!(step2.subject && step2.subject.trim())) &&
    !!preview &&
    preview.recipientCount > 0 &&
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
      {/* 분원 (선택된 1개만, 비대화형) */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[13px] font-medium text-[color:var(--text)]">
          발송 분원
        </span>
        <span className="inline-flex items-center h-9 px-3.5 rounded-full text-[14px] font-medium border bg-[color:var(--action)] text-[color:var(--action-text)] border-[color:var(--action)]">
          {branch}
        </span>
        <span className="text-[12px] text-[color:var(--text-dim)]">
          분원은 좌측 상단에서 변경합니다.
        </span>
      </div>

      {/* ── 문자 작성 ── */}
      <section className="space-y-5">
        <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
          문자 작성
        </h2>

        {/* 상단: 유형·템플릿 + 테스트 발송 (한 줄) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
          <div className="rounded-xl border border-[color:var(--border)] bg-bg-card p-4 space-y-4">
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
          </div>

          {/* 테스트 발송 — 유형·템플릿과 한 줄 오른쪽 */}
          <TestSendCard
            type={step2.type}
            subject={step2.subject ?? null}
            body={step2.body}
            isAd={step2.isAd}
            branch={branch}
            disabled={!step2.body.trim()}
          />
        </div>

        {/* 2박스: 작성 / 미리보기 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
          {/* 박스 1 — 문자 작성 */}
          <section
            aria-label="세정학원 문자 작성"
            className="rounded-xl border border-[color:var(--border)] bg-bg-card p-5 flex flex-col gap-4"
          >
            {/* 헤더: 제목 + 변수 삽입 */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-[15px] font-semibold text-[color:var(--text)]">
                세정학원 문자
              </h3>
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
            </div>

            {/* 제목 (LMS) */}
            {step2.type === "LMS" && (
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <label
                    htmlFor="compose-subject"
                    className="text-[13px] font-medium text-[color:var(--text)]"
                  >
                    제목
                    {step2.isAd && (
                      <span className="ml-1 text-[12px] font-normal text-[color:var(--text-muted)]">
                        (광고) 자동
                      </span>
                    )}
                  </label>
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
                <input
                  id="compose-subject"
                  type="text"
                  value={step2.subject ?? ""}
                  onChange={(e) =>
                    setStep2((s) => ({ ...s, subject: e.target.value }))
                  }
                  placeholder="제목을 입력하세요"
                  maxLength={40}
                  className={INPUT_CLASS}
                />
              </div>
            )}

            {/* 내용(본문) */}
            <div className="flex-1 flex flex-col gap-1.5 min-h-0">
              <div className="flex items-baseline justify-between gap-2">
                <label
                  htmlFor="compose-body"
                  className="text-[13px] font-medium text-[color:var(--text)]"
                >
                  내용
                </label>
                <span
                  className={`text-[11px] tabular-nums ${
                    bodyOverflow
                      ? "text-[color:var(--danger)] font-medium"
                      : "text-[color:var(--text-dim)]"
                  }`}
                  aria-live="polite"
                >
                  {finalBodyBytes.toLocaleString()} /{" "}
                  {bodyLimit.toLocaleString()} 바이트
                </span>
              </div>
              <textarea
                id="compose-body"
                ref={bodyRef}
                value={step2.body}
                onChange={(e) =>
                  setStep2((s) => ({ ...s, body: e.target.value }))
                }
                placeholder="문자 본문을 입력하세요."
                className={`${TEXTAREA_CLASS} flex-1`}
                style={{ fontFamily: "var(--font-sans)" }}
              />
              {bodyOverflow && (
                <p
                  role="alert"
                  className="flex items-center gap-1.5 text-[12px] text-[color:var(--danger)]"
                >
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
          </section>

          {/* 박스 2 — 미리보기 */}
          <section
            aria-label="미리보기"
            className="rounded-xl border border-[color:var(--border)] bg-bg-card p-5 space-y-3"
          >
            <div className="flex items-baseline justify-between">
              <h3 className="text-[15px] font-semibold text-[color:var(--text)]">
                미리보기
              </h3>
              <span className="text-[11px] text-[color:var(--text-dim)]">
                예시 학생 기준
              </span>
            </div>

            <PhonePreviewCard
              type={step2.type}
              subject={previewSubject}
              body={previewBody}
              isAd={step2.isAd}
              rawBytes={finalBodyBytes}
              rawOverflow={bodyOverflow}
              limit={bodyLimit}
              footer={
                step2.isAd ? { unsubscribePhone: optOutNumber } : undefined
              }
              recipientCount={preview?.recipientCount}
              brandName={brandName}
            />
          </section>
        </div>

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
          </fieldset>

        </section>

        {/* ── 발송 대상 ── */}
        <section className="space-y-4">
          <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
            발송 대상
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          <FilterChipPanel
            value={chip}
            onChange={(next) => {
              // 칩을 건드리면 prefill 고정 명단을 벗어나 조건(filter) 모드로 전환.
              if (useCustom) setUseCustom(false);
              // 코호트가 바뀌므로 선택 상태를 "전원 선택"(제외 모드)로 초기화.
              setSelectMode("exclude");
              setDeselected(new Set());
              setIncluded(new Set());
              setChip(next);
            }}
            branch={branch}
            schoolOptions={schoolOptions}
            classOptions={classOptions}
            availableGrades={availableGrades}
            availableRegions={availableRegions}
          />

          {/* 매칭 학생 목록 */}
          <Field
            fill
            label="매칭 학생"
            hint={
              listLoading
                ? "불러오는 중..."
                : `${effectiveTotal.toLocaleString()}명 중 ${checkedCount.toLocaleString()}명 선택`
            }
          >
            <div className="rounded-lg border border-[color:var(--border)] bg-bg-card h-full flex flex-col min-h-0">
              <div className="flex items-center justify-between gap-2 px-3 h-10 border-b border-[color:var(--border)]">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={recipients.length > 0 && allChecked}
                    ref={(el) => {
                      if (el) el.indeterminate = headerIndeterminate;
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
                    : noFilterCohort
                      ? `분원 전체 ${effectiveTotal.toLocaleString()}명이 발송 대상입니다. 학년·학교 등 조건을 선택하면 명단이 표시됩니다.`
                      : "조건에 맞는 학생이 없습니다. 위 필터를 조정해 주세요."}
                </p>
              )}

              {visibleRecipients.length > 0 && (
                <div className="relative flex-1 min-h-0">
                  <VirtualRecipientList
                    recipients={visibleRecipients}
                    isChecked={isRecipientChecked}
                    onToggle={toggleRecipient}
                  />
                </div>
              )}

              {truncated && (
                <p className="px-3 py-2 text-[12px] text-[color:var(--text-dim)] border-t border-[color:var(--border)]">
                  전체 {total.toLocaleString()}명 중 상위{" "}
                  {recipients.length.toLocaleString()}명만 목록에 표시됩니다.
                  {selectMode === "include"
                    ? " 표시된 학생 중에서 골라 선택할 수 있어요."
                    : " 일부만 보내려면 “전체 선택”을 해제한 뒤 보낼 학생만 체크하세요."}
                </p>
              )}
            </div>
          </Field>
          </div>

          <p className="text-[12px] text-[color:var(--text-dim)] leading-relaxed">
            비활성(탈퇴) · 수신거부 학생은 발송 시 자동 제외됩니다.
          </p>
        </section>

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
