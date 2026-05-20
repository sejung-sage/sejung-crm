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
 *   - 일반: SQL head:exact count + LIMIT 5 sample 4건 병렬 호출.
 *     6만 건 그룹도 ~1초 응답 (이전 구현은 50건/page × 1,200 round-trip = 4분).
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
  type Recipient,
} from "./guards";
import { calculateCost } from "./calculate-cost";
import type { SmsCostBreakdown } from "./cost-rates";
import type { GroupRow } from "@/types/database";
import { getUnsubscribedPhones } from "./unsubscribed-phones";

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
  /** 예상 비용 (recipientCount 기준). */
  cost: SmsCostBreakdown;
  /** 상위 5명 샘플. UI 측에서 마스킹 책임. */
  sampleRecipients: PreviewSampleRecipient[];
}

export interface PreviewRecipientsInput {
  groupId: string;
  body: string;
  isAd: boolean;
  type: "SMS" | "LMS" | "ALIMTALK";
  /** 미설정 → 현재 시각 (즉시 발송). */
  scheduledAt?: Date;
}

const SAMPLE_LIMIT = 5;

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
  const allCandidates = applyGroupFiltersDev(
    DEV_STUDENT_PROFILES,
    group.filters,
    group.branch,
  );
  const recipients: Recipient[] = allCandidates
    .filter((p) => !!p.parent_phone)
    .map((p) => ({
      studentId: p.id,
      phone: (p.parent_phone ?? "").replace(/\D/g, ""),
      name: p.name,
      status: p.status,
    }));

  const guarded = applyAllGuards({
    body: input.body,
    isAd: input.isAd,
    scheduledAt: input.scheduledAt ?? new Date(),
    recipients,
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

  return {
    recipientCount: guarded.eligible.length,
    excludedCount: guarded.excluded.length,
    excludedReasons,
    finalBody: guarded.finalBody,
    blockedByQuietHours: !guarded.allowedToSend,
    blockReason: guarded.blockReason,
    cost: calculateCost(input.type, guarded.eligible.length),
    sampleRecipients: guarded.eligible
      .slice(0, SAMPLE_LIMIT)
      .map((r) => ({ name: r.name, phone: r.phone })),
  };
}

// ─── Supabase 경로 (head count + LIMIT sample 병렬) ──────────

async function previewFromSupabase(
  input: PreviewRecipientsInput,
  group: GroupRow,
): Promise<PreviewResult> {
  const supabase = await createSupabaseServerClient();

  // 텍스트 가드는 row 무관 — 즉시 계산.
  const withAdTag = insertAdTag(input.body, input.isAd);
  const finalBody = insertUnsubscribeFooter(withAdTag, input.isAd);
  const quiet = checkQuietHours(input.scheduledAt ?? new Date(), input.isAd);

  // 1) 수신거부 phone 목록 — React cache 로 같은 요청 내 dedupe.
  const safeUnsubPhones = await getUnsubscribedPhones();

  // 2) 4건 병렬 — eligible count / sample / 탈퇴 count / 수신거부 count.
  //    head:exact count 는 body 안 받아 빠름 (PostgREST max_rows cap 무관).
  //    parent_phone IS NOT NULL 도 SQL 단에서 필터해 발송 가능 범위와 일치.
  const [eligibleCount, eligibleSample, withdrawnCount, unsubExcludedCount] =
    await Promise.all([
      countEligible(supabase, group, safeUnsubPhones),
      sampleEligible(supabase, group, safeUnsubPhones),
      countWithdrawn(supabase, group),
      countUnsubExcluded(supabase, group, safeUnsubPhones),
    ]);

  const excludedReasons: PreviewResult["excludedReasons"] = [];
  if (withdrawnCount > 0) {
    excludedReasons.push({ reason: "탈퇴학생", count: withdrawnCount });
  }
  if (unsubExcludedCount > 0) {
    excludedReasons.push({ reason: "수신거부", count: unsubExcludedCount });
  }

  return {
    recipientCount: eligibleCount,
    excludedCount: withdrawnCount + unsubExcludedCount,
    excludedReasons,
    finalBody,
    blockedByQuietHours: !quiet.allowed,
    blockReason: quiet.reason,
    cost: calculateCost(input.type, eligibleCount),
    sampleRecipients: eligibleSample,
  };
}

// ─── SQL 쿼리 빌더 ─────────────────────────────────────────

/**
 * 그룹 필터(branch + grades/schools/subjects/regions/includeStudentIds) 를
 * student_profiles 쿼리에 일괄 적용. count·sample 양쪽이 동일 필터셋을 갖도록
 * 한 곳에 모은다.
 *
 * `statusMode`:
 *   - "active"   : status != '탈퇴' (eligible/수신거부 카운트 대상)
 *   - "withdrawn": status =  '탈퇴' (탈퇴 사유 카운트)
 */
type StatusMode = "active" | "withdrawn";

function applyGroupFilters<Q extends ProfilesQueryBuilder>(
  query: Q,
  group: GroupRow,
  statusMode: StatusMode,
): Q {
  let q = query;

  q =
    statusMode === "withdrawn"
      ? (q.eq("status", "탈퇴") as Q)
      : (q.neq("status", "탈퇴") as Q);

  if (group.branch) {
    q = q.eq("branch", group.branch) as Q;
  }

  const f = group.filters;
  if (f.includeStudentIds.length > 0) {
    q = q.in("id", f.includeStudentIds) as Q;
  } else {
    if (f.grades.length > 0) q = q.in("grade", f.grades) as Q;
    if (f.schools.length > 0) q = q.in("school", f.schools) as Q;
    if (f.subjects.length > 0) q = q.overlaps("subjects", f.subjects) as Q;
    if (f.regions.length > 0) q = q.in("region", f.regions) as Q;
  }

  return q;
}

async function countEligible(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  group: GroupRow,
  unsubPhones: string[],
): Promise<number> {
  let q = applyGroupFilters(
    supabase
      .from("student_profiles")
      .select("id", { count: "exact", head: true }),
    group,
    "active",
  );
  q = q.not("parent_phone", "is", null);
  if (unsubPhones.length > 0) {
    // IS NOT NULL 위 가드 + parent_phone NOT IN (수신거부)
    q = q.not("parent_phone", "in", `(${unsubPhones.join(",")})`);
  }
  const { count, error } = await q;
  if (error) {
    throw new Error(`수신자 카운트 조회에 실패했습니다: ${error.message}`);
  }
  return count ?? 0;
}

async function sampleEligible(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  group: GroupRow,
  unsubPhones: string[],
): Promise<PreviewSampleRecipient[]> {
  let q = applyGroupFilters(
    supabase.from("student_profiles").select("name, parent_phone"),
    group,
    "active",
  );
  q = q.not("parent_phone", "is", null);
  if (unsubPhones.length > 0) {
    q = q.not("parent_phone", "in", `(${unsubPhones.join(",")})`);
  }
  const { data, error } = await q
    .order("registered_at", { ascending: false, nullsFirst: false })
    .limit(SAMPLE_LIMIT);
  if (error) {
    throw new Error(`수신자 샘플 조회에 실패했습니다: ${error.message}`);
  }
  return ((data ?? []) as Array<{ name: string; parent_phone: string | null }>)
    .map((r) => ({
      name: r.name,
      phone: (r.parent_phone ?? "").replace(/\D/g, ""),
    }))
    .filter((r) => r.phone.length > 0);
}

async function countWithdrawn(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  group: GroupRow,
): Promise<number> {
  const q = applyGroupFilters(
    supabase
      .from("student_profiles")
      .select("id", { count: "exact", head: true }),
    group,
    "withdrawn",
  );
  const { count, error } = await q;
  if (error) {
    throw new Error(`탈퇴학생 카운트 조회에 실패했습니다: ${error.message}`);
  }
  return count ?? 0;
}

async function countUnsubExcluded(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  group: GroupRow,
  unsubPhones: string[],
): Promise<number> {
  if (unsubPhones.length === 0) return 0;
  let q = applyGroupFilters(
    supabase
      .from("student_profiles")
      .select("id", { count: "exact", head: true }),
    group,
    "active",
  );
  q = q.in("parent_phone", unsubPhones);
  const { count, error } = await q;
  if (error) {
    throw new Error(`수신거부 카운트 조회에 실패했습니다: ${error.message}`);
  }
  return count ?? 0;
}

/** applyGroupFilters 의 제네릭 제약용 minimal 인터페이스. */
interface ProfilesQueryBuilder {
  eq(column: string, value: string): ProfilesQueryBuilder;
  neq(column: string, value: string): ProfilesQueryBuilder;
  in(column: string, values: readonly string[]): ProfilesQueryBuilder;
  overlaps(column: string, values: readonly string[]): ProfilesQueryBuilder;
  not(column: string, operator: string, value: string | null): ProfilesQueryBuilder;
  or(filters: string): ProfilesQueryBuilder;
}
