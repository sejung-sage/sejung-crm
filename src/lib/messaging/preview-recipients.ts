/**
 * F3 Part B · Compose 3단계 미리보기 산출.
 *
 * 발송 전에 다음을 미리 계산하여 UI 에 보여준다:
 *   - 그룹 수신자 후보 (탈퇴/수신거부 자동 제외 적용)
 *   - 안전 가드 적용된 최종 본문 ([광고] prefix / 080 footer)
 *   - 야간 광고 차단 여부
 *   - 예상 비용 (솔라피 단가)
 *   - 상위 5명 샘플 (서버 내부에선 raw, UI 에선 마스킹)
 *
 * 동작 모드:
 *   - dev-seed 모드: DEV_STUDENT_PROFILES + applyGroupFiltersDev 로 후보 산출.
 *     unsubscribes 시드 없음 → 빈 배열로 처리.
 *   - 일반 모드: listGroupStudents 호출 → unsubscribes 테이블 조회.
 *
 * 순수 함수에 가깝지만 dev-seed/Supabase 분기로 IO 가 있다.
 * 권한 가드는 호출부(Server Action) 책임.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getGroup } from "@/lib/groups/get-group";
import { listGroupStudents } from "@/lib/groups/list-group-students";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { applyAllGuards, type Recipient } from "./guards";
import { calculateCost } from "./calculate-cost";
import type { SmsCostBreakdown } from "./cost-rates";

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
  // 그룹 → 수신자 후보 수집
  const group = await getGroup(input.groupId);
  if (!group) {
    throw new Error("존재하지 않는 그룹입니다");
  }

  // 1) 수신자 후보 (탈퇴는 listGroupStudents 가 이미 제외함)
  //    1만건 수신자도 한 번에 가져오기 위해 페이지 크기 우회
  //    listGroupStudents 는 50건/페이지이므로 Supabase 모드에서 수신자 많으면
  //    여러 페이지를 모아야 한다. 현 시점 MVP 는 단일 그룹 1만건 이내 가정.
  const allCandidates = await collectAllGroupCandidates(input.groupId);

  // 2) Recipient 형 변환 (필터 가드는 phone 기준으로 정규화)
  const recipients: Recipient[] = allCandidates
    .filter((p) => !!p.parent_phone)
    .map((p) => ({
      studentId: p.id,
      phone: (p.parent_phone ?? "").replace(/\D/g, ""),
      name: p.name,
      status: p.status,
    }));

  // 3) unsubscribes 조회 (dev-seed 는 빈 배열)
  const unsubscribedPhones = await fetchUnsubscribedPhones();

  // 4) 가드 일괄 적용
  const guarded = applyAllGuards({
    body: input.body,
    isAd: input.isAd,
    scheduledAt: input.scheduledAt ?? new Date(),
    recipients,
    unsubscribedPhones,
  });

  // 5) 제외 사유 집계
  const reasonMap = new Map<PreviewExclusionReason, number>();
  for (const ex of guarded.excluded) {
    reasonMap.set(ex.reason, (reasonMap.get(ex.reason) ?? 0) + 1);
  }
  const excludedReasons: PreviewResult["excludedReasons"] = [];
  for (const [reason, count] of reasonMap) {
    if (count > 0) excludedReasons.push({ reason, count });
  }

  // 6) 비용 계산
  const cost = calculateCost(input.type, guarded.eligible.length);

  // 7) 상위 5명 샘플
  const sampleRecipients: PreviewSampleRecipient[] = guarded.eligible
    .slice(0, SAMPLE_LIMIT)
    .map((r) => ({ name: r.name, phone: r.phone }));

  return {
    recipientCount: guarded.eligible.length,
    excludedCount: guarded.excluded.length,
    excludedReasons,
    finalBody: guarded.finalBody,
    blockedByQuietHours: !guarded.allowedToSend,
    blockReason: guarded.blockReason,
    cost,
    sampleRecipients,
  };
}

// ─── 내부 헬퍼 ──────────────────────────────────────────────

/**
 * 그룹의 모든 수신자 후보를 페이지를 넘어 모은다.
 * `listGroupStudents` 의 페이지 크기(50)에 맞춰 반복 호출.
 * 안전 상한 1만 명 (그 이상은 잘림 + 추후 stream 화 필요).
 */
async function collectAllGroupCandidates(groupId: string): Promise<
  {
    id: string;
    name: string;
    parent_phone: string | null;
    status: string;
  }[]
> {
  const HARD_CAP = 10_000;
  const collected: {
    id: string;
    name: string;
    parent_phone: string | null;
    status: string;
  }[] = [];
  let page = 1;
  for (;;) {
    const res = await listGroupStudents(groupId, { page });
    for (const r of res.items) {
      collected.push({
        id: r.id,
        name: r.name,
        parent_phone: r.parent_phone ?? null,
        status: r.status,
      });
      if (collected.length >= HARD_CAP) return collected;
    }
    const reached = page * res.items.length;
    if (res.items.length === 0 || collected.length >= res.total) {
      return collected;
    }
    if (reached >= HARD_CAP) return collected;
    page += 1;
    // 안전 가드: 수만 페이지 무한루프 방지
    if (page > 1000) return collected;
  }
}

/**
 * unsubscribes 테이블에서 phone 목록을 가져온다.
 * dev-seed 모드는 빈 배열.
 */
async function fetchUnsubscribedPhones(): Promise<string[]> {
  if (isDevSeedMode()) return [];

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("unsubscribes").select("phone");
  if (error) {
    throw new Error(`수신거부 목록 조회에 실패했습니다: ${error.message}`);
  }
  return (data ?? [])
    .map((r) => (r as { phone: string }).phone)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
}
