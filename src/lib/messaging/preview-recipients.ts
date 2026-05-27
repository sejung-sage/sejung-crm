/**
 * F3 Part B · Compose 3단계 미리보기 산출.
 *
 * 발송 전에 다음을 미리 계산하여 UI 에 보여준다:
 *   - 그룹 수신자 후보 (탈퇴/수신거부 자동 제외 적용)
 *   - 안전 가드 적용된 최종 본문 ([광고] prefix / 080 footer)
 *   - 야간 광고 차단 여부
 *   - 예상 비용 (sendon 단가)
 *   - 상위 5명 샘플 (서버 내부에선 raw, UI 에선 마스킹)
 *
 * 동작 모드:
 *   - dev-seed: DEV_STUDENT_PROFILES + applyGroupFiltersDev 로 후보 산출.
 *     unsubscribes 시드 없음 → 빈 배열.
 *   - 일반: crm_students 인덱스 기반 head:exact count + LIMIT 5 sample 병렬 호출.
 *     student_profiles 뷰(LEFT JOIN + GROUP BY 풀 집계) 우회 → 6만+ 학생에서도
 *     statement_timeout 안전권.
 *
 * 권한 가드는 호출부(Server Action) 책임.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getGroup } from "@/lib/groups/get-group";
import {
  DEV_STUDENT_PROFILES,
  isDevSeedMode,
} from "@/lib/profile/students-dev-seed";
import { applyGroupFiltersDev } from "@/lib/groups/apply-filters";
import {
  applyAllGuards,
  checkQuietHours,
  insertAdTag,
  insertUnsubscribeFooter,
} from "./guards";
import { calculateCost } from "./calculate-cost";
import { collapseByPhone } from "./dedupe-recipients";
import { expandRecipientLegs, countDistinctStudents } from "./expand-legs";
import type { SmsCostBreakdown } from "./cost-rates";
import type { GroupRow, StudentStatus } from "@/types/database";
import type { DedupeCounts } from "@/types/messaging";
import { getUnsubscribedPhones } from "./unsubscribed-phones";
import { loadAllGroupRecipients } from "@/lib/groups/load-all-group-recipients";
import { isCustomGroup } from "@/lib/schemas/group";
import { isAllSubjects } from "@/lib/schemas/common";
import {
  applySchoolExclusion,
  loadExcludedClassStudentIds,
  mergeExcludedStudentIds,
} from "@/lib/groups/resolve-exclusions";

export type PreviewExclusionReason = "탈퇴학생" | "수신거부";

export interface PreviewSampleRecipient {
  /** 학생 이름. dev-seed/Supabase 모두 채움. */
  name: string;
  /** 하이픈 없는 11자리 휴대폰. 서버 내부 용 raw — UI 측에서 마스킹. */
  phone: string;
}

export interface PreviewResult {
  /** 발송 대상 인원(가드 적용 후). */
  recipientCount: number;
  /** 제외된 인원(전체 합). */
  excludedCount: number;
  /** 제외 사유별 집계. count 가 0 인 사유는 포함하지 않음. */
  excludedReasons: { reason: PreviewExclusionReason; count: number }[];
  /** 가드 적용된 최종 본문(광고 prefix · 080 footer). */
  finalBody: string;
  /** 야간 광고 차단 여부. */
  blockedByQuietHours: boolean;
  /** blockedByQuietHours=true 일 때만 채워짐. */
  blockReason?: string;
  /**
   * 예상 비용.
   *  - dedupe OFF: recipientCount(=가드 통과 후보) 기준.
   *  - dedupe ON : dedupe.actualMessages(고유 번호 수) 기준 — 절감액이 여기서 발생.
   */
  cost: SmsCostBreakdown;
  /** 상위 5명 샘플. UI 측에서 마스킹 책임. */
  sampleRecipients: PreviewSampleRecipient[];
  /**
   * 동일번호 1회 발송(중복 번호 dedupe) 카운트.
   *  - dedupeByPhone=false: dedupeApplied=false, actualMessages=targetStudents, collapsed=0.
   *  - dedupeByPhone=true : actualMessages=고유 parent_phone 수.
   * targetStudents 는 recipientCount 와 동일(가드 통과 후 발송 후보 학생 수).
   */
  dedupe: DedupeCounts;
}

export interface PreviewRecipientsInput {
  groupId: string;
  body: string;
  isAd: boolean;
  type: "SMS" | "LMS" | "ALIMTALK";
  /**
   * 동일번호 1회 발송(중복 번호 dedupe). TRUE 면 고유 번호 수를 산출해
   * actualMessages/cost 에 반영한다. 미설정 시 false 동작.
   */
  dedupeByPhone?: boolean;
  /**
   * 발송 대상 — 학부모 대표번호(parent_phone) 레그. 미설정 시 true(세정 기본값).
   * 0077. sendToStudent 와 독립.
   */
  sendToParent?: boolean;
  /**
   * 발송 대상 — 학생 개인번호(phone) 레그. 미설정 시 false. 0077.
   */
  sendToStudent?: boolean;
  /** 미설정 → 현재 시각 (즉시 발송). */
  scheduledAt?: Date;
}

/** PreviewRecipientsInput 의 발송 대상 토글 정규화 (미설정 = 세정 운영 기본값). */
function resolvePreviewTargets(input: PreviewRecipientsInput): {
  sendToParent: boolean;
  sendToStudent: boolean;
} {
  return {
    sendToParent: input.sendToParent ?? true,
    sendToStudent: input.sendToStudent ?? false,
  };
}

const SAMPLE_LIMIT = 5;
/** dedupe 미리보기에서 후보 phone 을 로드할 최대 인원. 발송 상한과 동일. */
const MAX_PREVIEW_DEDUPE_RECIPIENTS = 100_000;

export async function previewRecipients(
  input: PreviewRecipientsInput,
): Promise<PreviewResult> {
  const group = await getGroup(input.groupId);
  if (!group) {
    throw new Error("존재하지 않는 그룹입니다");
  }

  if (isDevSeedMode()) {
    return previewFromDevSeed(input, group);
  }
  return previewFromSupabase(input, group);
}

// ─── dev-seed 경로 (인메모리, 변경 없음) ─────────────────────

function previewFromDevSeed(
  input: PreviewRecipientsInput,
  group: GroupRow,
): PreviewResult {
  const targets = resolvePreviewTargets(input);
  const allCandidates = applyGroupFiltersDev(
    DEV_STUDENT_PROFILES,
    group.filters,
    group.branch,
  );

  // 레그 확장 — 산출 순서 1단계. GroupRecipient 형태로 정규화 후 expandRecipientLegs.
  //  dev-seed 는 수신거부 시드 미보유라 unsubscribedPhones 비움.
  const legs = expandRecipientLegs(
    allCandidates.map((p) => ({
      id: p.id,
      name: p.name,
      parent_phone: p.parent_phone,
      phone: p.phone,
      status: p.status,
    })),
    {
      sendToParent: targets.sendToParent,
      sendToStudent: targets.sendToStudent,
      unsubscribedPhones: [],
    },
  );

  // targetStudents = 레그 1개 이상 생성된 고유 학생 수.
  const targetStudents = countDistinctStudents(legs);

  const guarded = applyAllGuards({
    body: input.body,
    isAd: input.isAd,
    scheduledAt: input.scheduledAt ?? new Date(),
    recipients: legs,
    unsubscribedPhones: [], // dev-seed 미보유
  });

  const reasonMap = new Map<PreviewExclusionReason, number>();
  for (const ex of guarded.excluded) {
    reasonMap.set(ex.reason, (reasonMap.get(ex.reason) ?? 0) + 1);
  }
  const excludedReasons: PreviewResult["excludedReasons"] = [];
  for (const [reason, count] of reasonMap) {
    if (count > 0) excludedReasons.push({ reason, count });
  }

  // dedupe — 가드 통과 후 eligible 레그에만 collapse. 비용은 actualMessages 기준.
  const { counts: dedupe } = collapseByPhone(
    guarded.eligible.map((r) => ({
      studentId: r.studentId,
      phone: r.phone,
      name: r.name,
    })),
    input.dedupeByPhone ?? false,
    countDistinctStudents(guarded.eligible),
  );

  return {
    // recipientCount = 발송 후보 "학생" 수(사람 수). 레그 합계는 dedupe.legs.
    recipientCount: targetStudents,
    excludedCount: guarded.excluded.length,
    excludedReasons,
    finalBody: guarded.finalBody,
    blockedByQuietHours: !guarded.allowedToSend,
    blockReason: guarded.blockReason,
    cost: calculateCost(input.type, dedupe.actualMessages),
    sampleRecipients: guarded.eligible
      .slice(0, SAMPLE_LIMIT)
      .map((r) => ({ name: r.name, phone: r.phone })),
    dedupe,
  };
}

// ─── Supabase 경로 (crm_students 인덱스 베이스) ──────────────

async function previewFromSupabase(
  input: PreviewRecipientsInput,
  group: GroupRow,
): Promise<PreviewResult> {
  const supabase = await createSupabaseServerClient();
  const targets = resolvePreviewTargets(input);

  // 텍스트 가드는 row 무관 — 즉시 계산.
  const withAdTag = insertAdTag(input.body, input.isAd);
  const finalBody = insertUnsubscribeFooter(withAdTag, input.isAd);
  const quiet = checkQuietHours(input.scheduledAt ?? new Date(), input.isAd);

  // 1) 수신거부 phone 목록 — React cache 로 같은 요청 내 dedupe.
  const safeUnsubPhones = await getUnsubscribedPhones();

  // 2) subjects/regions 사전 매핑.
  //    student_profiles 뷰의 array_agg(subjects) overlaps / region join 대신
  //    enrollments · school_regions 의 작은 인덱스 조회로 student_id/school 만
  //    뽑아 crm_students 의 in() 절로 적용. 풀 집계 회피.
  const mapping = await resolveFilterMapping(supabase, group);
  if (mapping.zeroResult) {
    return emptyPreview(input, finalBody, quiet);
  }

  // 3) 4건 병렬 — eligible count / sample / 탈퇴 count / 수신거부 count.
  const [eligibleCount, eligibleSample, withdrawnCount, unsubExcludedCount] =
    await Promise.all([
      countEligible(supabase, group, mapping, safeUnsubPhones),
      sampleEligible(supabase, group, mapping, safeUnsubPhones),
      countWithdrawn(supabase, group, mapping),
      countUnsubExcluded(supabase, group, mapping, safeUnsubPhones),
    ]);

  const excludedReasons: PreviewResult["excludedReasons"] = [];
  if (withdrawnCount > 0) {
    excludedReasons.push({ reason: "탈퇴학생", count: withdrawnCount });
  }
  if (unsubExcludedCount > 0) {
    excludedReasons.push({ reason: "수신거부", count: unsubExcludedCount });
  }

  // 레그 카운트 산출.
  //   - 학부모 단독 + dedupe OFF: 추가 쿼리 없이 fast count(eligibleCount) 사용.
  //     이 경로에선 legs = targetStudents = actualMessages (종전 동작 동일).
  //   - 학생 레그 포함 또는 dedupe ON: 후보 전체 로드 후 레그 확장으로 정확 산출.
  const dedupe = await resolveLegCounts({
    supabase,
    group,
    eligibleCount,
    dedupeByPhone: input.dedupeByPhone ?? false,
    sendToParent: targets.sendToParent,
    sendToStudent: targets.sendToStudent,
  });

  return {
    // recipientCount = 발송 후보 "학생" 수(사람 수). 레그 합계는 dedupe.legs.
    recipientCount: dedupe.targetStudents,
    excludedCount: withdrawnCount + unsubExcludedCount,
    excludedReasons,
    finalBody,
    blockedByQuietHours: !quiet.allowed,
    blockReason: quiet.reason,
    // 비용은 actualMessages(레그 dedupe 후) 기준 — dedupe/단일학생 절감액 반영.
    cost: calculateCost(input.type, dedupe.actualMessages),
    sampleRecipients: eligibleSample,
    dedupe,
  };
}

/**
 * 레그 카운트 산출 (Supabase 경로). DedupeCounts(targetStudents/legs/
 * actualMessages/collapsed) 를 정확히 채운다.
 *
 * fast-path (추가 쿼리 없음):
 *   학부모 단독(sendToParent && !sendToStudent) + dedupeByPhone=false.
 *   이 경로에선 한 학생 = 학부모 레그 1개라 legs = targetStudents = eligibleCount
 *   (fast head count). actualMessages = legs (종전 동작 동일).
 *
 * full-load path (loadAllGroupRecipients):
 *   학생 레그 포함(sendToStudent) 또는 dedupeByPhone=true.
 *   후보 전체(분원·탈퇴 SQL 단 + registered_at DESC) 를 로드해 레그 확장:
 *     - 레그별 번호 기준 수신거부 제외(가드 강화)
 *     - 번호 결측 레그 스킵
 *   확장 결과로 targetStudents(고유 학생 수)·legs(레그 합계) 를 세고,
 *   dedupe ON 이면 고유 정규화 번호 수를 actualMessages 로, OFF 면 legs 그대로.
 *
 * PostgREST max_rows(1,000) 청크 페이징은 loadAllGroupRecipients 내부에서 처리.
 *
 * 불변식: actualMessages = legs - collapsed (>= 0), legs >= targetStudents.
 */
async function resolveLegCounts(args: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  group: GroupRow;
  eligibleCount: number;
  dedupeByPhone: boolean;
  sendToParent: boolean;
  sendToStudent: boolean;
}): Promise<DedupeCounts> {
  const {
    supabase,
    group,
    eligibleCount,
    dedupeByPhone,
    sendToParent,
    sendToStudent,
  } = args;

  // fast-path: 학부모 단독 + dedupe OFF → 추가 쿼리 없이 fast count 사용.
  if (sendToParent && !sendToStudent && !dedupeByPhone) {
    return {
      dedupeApplied: false,
      targetStudents: eligibleCount,
      legs: eligibleCount,
      actualMessages: eligibleCount,
      collapsed: 0,
    };
  }

  // full-load path — 후보 전체 로드 + 레그 확장.
  const [rows, unsubPhones] = await Promise.all([
    loadAllGroupRecipients(supabase, group.id, MAX_PREVIEW_DEDUPE_RECIPIENTS),
    getUnsubscribedPhones(),
  ]);

  const legArr = expandRecipientLegs(rows, {
    sendToParent,
    sendToStudent,
    unsubscribedPhones: unsubPhones,
  });

  const targetStudents = countDistinctStudents(legArr);
  const { counts } = collapseByPhone(
    legArr.map((r) => ({
      studentId: r.studentId,
      phone: r.phone,
      name: r.name,
    })),
    dedupeByPhone,
    targetStudents,
  );
  return counts;
}

function emptyPreview(
  input: PreviewRecipientsInput,
  finalBody: string,
  quiet: ReturnType<typeof checkQuietHours>,
): PreviewResult {
  return {
    recipientCount: 0,
    excludedCount: 0,
    excludedReasons: [],
    finalBody,
    blockedByQuietHours: !quiet.allowed,
    blockReason: quiet.reason,
    cost: calculateCost(input.type, 0),
    sampleRecipients: [],
    dedupe: {
      dedupeApplied: input.dedupeByPhone ?? false,
      targetStudents: 0,
      legs: 0,
      actualMessages: 0,
      collapsed: 0,
    },
  };
}

// ─── 사전 매핑 (subjects/regions) ──────────────────────────

interface FilterMapping {
  /** filters.subjects 또는 includeStudentIds → 최종 allowed id 집합 (null 이면 미적용). */
  allowedStudentIds: string[] | null;
  /** filters.regions → 매칭 school 목록 (null 이면 미적용). */
  allowedSchools: string[] | null;
  /**
   * 차감 대상 student_id 병합 목록 (excludeStudentIds ∪ excludeClassIds 펼침).
   * 빈 배열이면 차감 미적용. buildQuery 가 4개 쿼리 모두에 not.in 으로 적용 →
   * eligible/sample/withdrawn/unsub 카운트가 전부 exclude 차감된 모집단 위에서 계산된다.
   */
  excludeStudentIds: string[];
  /** filters.excludeSchools — school NOT IN 차감. 빈 배열이면 미적용. */
  excludeSchools: string[];
  /** 사전 매핑 결과가 빈 집합으로 확정될 때 true. 즉시 빈 결과 short-circuit. */
  zeroResult: boolean;
}

async function resolveFilterMapping(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  group: GroupRow,
): Promise<FilterMapping> {
  const f = group.filters;

  // 그룹 종류 분기 (2026-05-27) — isCustomGroup 술어 경유.
  // custom: includeStudentIds 모집단(필터/excludeSchools/excludeClassIds 무시),
  //         excludeStudentIds 차감만 유지.
  // filter: 조건 모집단(includeStudentIds 무시), exclude 3종 차감.
  const custom = isCustomGroup(f);

  // 제외 차감 사전 페치 — 강좌 제외는 filter 전용(custom 은 무시).
  //   include/조건 분기, zeroResult 분기와 무관하게 모든 return 에 동일 차감을 실어
  //   보낸다(exclude 승리). 강좌 제외는 강좌 수가 적어 1회성 2쿼리.
  const excludeClassStudentIds = custom
    ? []
    : await loadExcludedClassStudentIds(supabase, f.excludeClassIds ?? []);
  // 명시 제외는 두 종류 공통(custom 도 개별 제거 유지). 강좌 펼침은 filter 한정.
  const excludeStudentIds = mergeExcludedStudentIds(
    f.excludeStudentIds ?? [],
    excludeClassStudentIds,
  );
  // 학교별 제외는 filter 전용. custom 은 excludeSchools 무시.
  const excludeSchools = custom ? [] : (f.excludeSchools ?? []);

  // zeroResult 단축 시에도 exclude 필드를 채워 타입/시맨틱 일관 유지.
  const zero = (): FilterMapping => ({
    allowedStudentIds: null,
    allowedSchools: null,
    excludeStudentIds,
    excludeSchools,
    zeroResult: true,
  });

  // custom(고정 명단): includeStudentIds 명단만 모집단. 필터/subjects 무시.
  // 빈 명단이면 모집단 0명 → zeroResult.
  if (custom) {
    if (f.includeStudentIds.length === 0) {
      return zero();
    }
    return {
      allowedStudentIds: f.includeStudentIds,
      allowedSchools: null,
      excludeStudentIds,
      excludeSchools,
      zeroResult: false,
    };
  }

  // filter(조건 동기화): includeStudentIds 무시. subjects/regions 사전 매핑.
  let allowedStudentIds: string[] | null = null;
  if (f.subjects.length > 0 && !isAllSubjects(f.subjects)) {
    // ETL 정책상 crm_enrollments.subject 는 항상 NULL → crm_classes.subject 로
    // aca_class_id 사전 페치 후 enrollments 의 aca_class_id 매칭.
    // 7종 전체 = "조건 없음" 정규화 (count-recipients 와 동일 정책).
    const { data: classRows, error: classErr } = await supabase
      .from("crm_classes")
      .select("aca_class_id")
      .in("subject", f.subjects)
      .not("aca_class_id", "is", null);
    if (classErr) {
      throw new Error(`강좌 조회에 실패했습니다: ${classErr.message}`);
    }
    const acaClassIds = (classRows ?? [])
      .map((r) => (r as { aca_class_id: string | null }).aca_class_id)
      .filter((v): v is string => typeof v === "string" && v.length > 0);
    if (acaClassIds.length === 0) {
      return zero();
    }

    const { data: enrollRows, error: enrollErr } = await supabase
      .from("crm_enrollments")
      .select("student_id")
      .in("aca_class_id", acaClassIds);
    if (enrollErr) {
      throw new Error(`수강 정보 조회에 실패했습니다: ${enrollErr.message}`);
    }
    const set = new Set<string>();
    for (const r of (enrollRows ?? []) as { student_id: string }[]) {
      if (r.student_id) set.add(r.student_id);
    }
    if (set.size === 0) {
      return zero();
    }
    allowedStudentIds = Array.from(set);
  }

  let allowedSchools: string[] | null = null;
  if (f.regions.length > 0) {
    const { data: regionRows, error: regErr } = await supabase
      .from("crm_school_regions")
      .select("school")
      .in("region", f.regions);
    if (regErr) {
      throw new Error(`지역 매핑 조회에 실패했습니다: ${regErr.message}`);
    }
    allowedSchools = (regionRows ?? [])
      .map((r) => (r as { school: string }).school)
      .filter((s): s is string => typeof s === "string" && s.length > 0);
    if (allowedSchools.length === 0) {
      return zero();
    }
  }

  return {
    allowedStudentIds,
    allowedSchools,
    excludeStudentIds,
    excludeSchools,
    zeroResult: false,
  };
}

// ─── crm_students 쿼리 빌더 ─────────────────────────────────

type StudentsQuery = ReturnType<
  ReturnType<
    Awaited<ReturnType<typeof createSupabaseServerClient>>["from"]
  >["select"]
>;

interface BuildOptions {
  /** 'eligible': status != '탈퇴' (+ statuses 필터 적용)
   *  'withdrawn': status = '탈퇴' (statuses 필터 무시 — 탈퇴 자동제외 안내용) */
  statusMode: "eligible" | "withdrawn";
}

/**
 * 그룹 필터(branch + grades/schools/subjects/regions/includeStudentIds/excludeStudentIds/statuses)
 * 를 crm_students 쿼리에 일괄 적용.
 *
 * - subjects/regions 는 사전 매핑된 allowedStudentIds/allowedSchools 로 in() 적용.
 * - statuses 는 빈 배열이면 default '재원생' (count-recipients 와 동일 시맨틱).
 *   statusMode='withdrawn' 일 땐 statuses 무시하고 status='탈퇴' 강제 — "이 그룹
 *   매치 학생 중 탈퇴 m명 자동 제외" 안내가 사용자 status 선택과 무관하게 일관 표시.
 */
function buildQuery(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  selectExpr: string,
  options: { count?: "exact"; head?: boolean },
  group: GroupRow,
  mapping: FilterMapping,
  build: BuildOptions,
): StudentsQuery {
  const f = group.filters;
  let q = supabase
    .from("crm_students")
    .select(selectExpr, options) as StudentsQuery;

  // 분원
  if (group.branch) {
    q = q.eq("branch", group.branch);
  }

  // status
  if (build.statusMode === "withdrawn") {
    q = q.eq("status", "탈퇴");
  } else {
    // 탈퇴 안전 차단 + statuses 적용. 빈 배열 default = 탈퇴 빼고 전체.
    // count-recipients · apply-filters 와 동일 시맨틱.
    const wantedStatuses: StudentStatus[] =
      f.statuses.length > 0
        ? f.statuses
        : ["재원생", "수강이력자", "수강 x"];
    q = q.in("status", wantedStatuses);
    // wantedStatuses 에 '탈퇴' 가 들어와도 명시적으로 차단 (안전 정책).
    q = q.neq("status", "탈퇴");
  }

  // id 좁힘 (includeStudentIds 우선, 그 다음 subjects 사전 매핑)
  if (mapping.allowedStudentIds) {
    q = q.in("id", mapping.allowedStudentIds);
  } else {
    if (f.grades.length > 0) q = q.in("grade", f.grades);
    if (f.schools.length > 0) q = q.in("school", f.schools);
    if (mapping.allowedSchools) q = q.in("school", mapping.allowedSchools);
  }

  // 강제 제외 (PostgREST not.in 문법). mapping.excludeStudentIds 는
  //   excludeStudentIds ∪ excludeClassIds(펼친 student_id) 병합 목록.
  //   uuid 만 들어와 메타문자 인젝션 위험 없음.
  // 4개 쿼리(eligible/sample/withdrawn/unsub) 모두 buildQuery 를 거치므로
  //   withdrawn/unsub 카운트도 exclude 차감된 모집단 위에서 계산된다 —
  //   제외된 학생은 "탈퇴 자동 제외" 안내에 잡히지 않는다.
  if (mapping.excludeStudentIds.length > 0) {
    q = q.not("id", "in", `(${mapping.excludeStudentIds.join(",")})`);
  }
  // 학교별 제외 — school NOT IN (...). 빈 배열이면 미적용. school IS NULL 은 차감 안 됨.
  q = applySchoolExclusion(q, mapping.excludeSchools) as StudentsQuery;

  return q;
}

// ─── 4건 카운트/샘플 ───────────────────────────────────────

async function countEligible(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  group: GroupRow,
  mapping: FilterMapping,
  unsubPhones: string[],
): Promise<number> {
  let q = buildQuery(
    supabase,
    "id",
    { count: "exact", head: true },
    group,
    mapping,
    { statusMode: "eligible" },
  );
  q = q.not("parent_phone", "is", null);
  if (unsubPhones.length > 0) {
    q = q.not("parent_phone", "in", `(${unsubPhones.join(",")})`);
  }
  const { count, error } = (await q) as {
    count: number | null;
    error: { message: string } | null;
  };
  if (error) {
    throw new Error(`수신자 카운트 조회에 실패했습니다: ${error.message}`);
  }
  return count ?? 0;
}

async function sampleEligible(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  group: GroupRow,
  mapping: FilterMapping,
  unsubPhones: string[],
): Promise<PreviewSampleRecipient[]> {
  let q = buildQuery(
    supabase,
    "name, parent_phone",
    {},
    group,
    mapping,
    { statusMode: "eligible" },
  );
  q = q.not("parent_phone", "is", null);
  if (unsubPhones.length > 0) {
    q = q.not("parent_phone", "in", `(${unsubPhones.join(",")})`);
  }
  const { data, error } = (await (
    q as unknown as {
      order: (
        col: string,
        opts: { ascending: boolean; nullsFirst?: boolean },
      ) => {
        limit: (n: number) => Promise<{
          data: Array<{ name: string; parent_phone: string | null }> | null;
          error: { message: string } | null;
        }>;
      };
    }
  )
    .order("registered_at", { ascending: false, nullsFirst: false })
    .limit(SAMPLE_LIMIT));
  if (error) {
    throw new Error(`수신자 샘플 조회에 실패했습니다: ${error.message}`);
  }
  return (data ?? [])
    .map((r) => ({
      name: r.name,
      phone: (r.parent_phone ?? "").replace(/\D/g, ""),
    }))
    .filter((r) => r.phone.length > 0);
}

async function countWithdrawn(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  group: GroupRow,
  mapping: FilterMapping,
): Promise<number> {
  const q = buildQuery(
    supabase,
    "id",
    { count: "exact", head: true },
    group,
    mapping,
    { statusMode: "withdrawn" },
  );
  const { count, error } = (await q) as {
    count: number | null;
    error: { message: string } | null;
  };
  if (error) {
    throw new Error(`탈퇴학생 카운트 조회에 실패했습니다: ${error.message}`);
  }
  return count ?? 0;
}

async function countUnsubExcluded(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  group: GroupRow,
  mapping: FilterMapping,
  unsubPhones: string[],
): Promise<number> {
  if (unsubPhones.length === 0) return 0;
  let q = buildQuery(
    supabase,
    "id",
    { count: "exact", head: true },
    group,
    mapping,
    { statusMode: "eligible" },
  );
  q = q.in("parent_phone", unsubPhones);
  const { count, error } = (await q) as {
    count: number | null;
    error: { message: string } | null;
  };
  if (error) {
    throw new Error(`수신거부 카운트 조회에 실패했습니다: ${error.message}`);
  }
  return count ?? 0;
}
