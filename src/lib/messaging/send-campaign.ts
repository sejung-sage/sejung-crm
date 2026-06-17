/**
 * F3 Part B · 캠페인 발송 오케스트레이터.
 *
 * 입력 (`SendCampaignInput`) 으로부터:
 *   1) dev-seed 모드 차단
 *   2) 권한 검사 (master/admin/manager · 본인 분원 그룹)
 *   3) previewRecipients 호출 → 야간 광고 차단 / 수신자 0명 케이스 처리
 *   4) 즉시 발송: campaigns INSERT(상태 발송중) → messages 일괄 INSERT(상태 대기)
 *               → 어댑터 호출(batch=100) → messages 상태 갱신
 *               → 모두 끝난 뒤 campaigns 상태(완료/실패) + total_cost 갱신
 *   5) 예약 발송: campaigns INSERT(상태 예약됨, scheduled_at 만 저장).
 *               messages 는 실 발송 시점(Phase 1 cron)에 INSERT.
 *
 * 발송 결과는 `SendCampaignResult` 의 discriminated union 으로 반환.
 * `revalidatePath('/campaigns')` 로 리스트 갱신.
 *
 * 보안:
 *   - SUPABASE 직접 INSERT/UPDATE 시 좁은 cast 사용 (groups/templates actions 패턴).
 *   - 학부모 번호는 raw 처리 (DB 저장은 raw, UI 측은 마스킹 표시 책임).
 *   - 어댑터/Supabase 에러 메시지에 API Key/Secret 이 섞일 가능성은 어댑터가 한 번 더
 *     필터링하지만, 본 레이어에서도 message 만 추출해 사용한다.
 */

import { revalidatePath } from "next/cache";
import { waitUntil } from "@vercel/functions";
import { previewRecipients, type PreviewResult } from "./preview-recipients";
import { applyAllGuards, branchBrandName } from "./guards";
import { collapseByPhone } from "./dedupe-recipients";
import { expandRecipientLegs, countDistinctStudents } from "./expand-legs";
import { getUnsubscribedPhones } from "./unsubscribed-phones";
import { getMessagingBaseUrl } from "./base-url";
import { getGroup } from "@/lib/groups/get-group";
import { loadRecipientsByFilters } from "@/lib/groups/load-all-group-recipients";
import type { GroupFilters } from "@/lib/schemas/group";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/can";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface SendCampaignInput {
  title: string;
  /**
   * 그룹 기반 발송. 필터 기반(filters+branch) 발송이면 생략. 둘 중 하나 필수.
   * 그룹 기반이면 campaigns.group_id 에 저장되고, 필터 기반이면 group_id=null.
   */
  groupId?: string;
  /** 필터 기반(그룹 없이) 발송. branch 와 함께. groupId 와 상호배타. */
  filters?: GroupFilters;
  /** 필터 기반 발송 분원. filters 와 함께. */
  branch?: string;
  /** null 이면 inline 본문 (템플릿 미사용). */
  templateId: string | null;
  body: string;
  /** SMS 는 null. LMS/알림톡은 필수. */
  subject: string | null;
  type: "SMS" | "LMS" | "ALIMTALK";
  isAd: boolean;
  /**
   * 동일번호 1회 발송(중복 번호 dedupe). TRUE 면 같은 학부모 번호로 묶인 형제
   * N명을 1건으로 합쳐 발송. 가드 통과 후 collapse 단계에서 적용된다.
   * {이름} 개인화와 상호배타(Zod refine 이 강제).
   */
  dedupeByPhone: boolean;
  /**
   * 발송 대상 — 학부모 대표번호(parent_phone)로 발송할지. 0077.
   * 미설정 시 true (세정 운영 기본값 = 학부모 단독 발송, 종전 동작 보존).
   * sendToStudent 와 독립이며 둘 다 true 면 한 학생이 학부모·학생 양쪽으로
   * 최대 2개 레그로 확장된다(번호 없는 레그는 스킵).
   */
  sendToParent?: boolean;
  /**
   * 발송 대상 — 학생 개인번호(phone)로 발송할지. 0077.
   * 미설정 시 false (종전 동작 보존). sendToParent 와 독립.
   */
  sendToStudent?: boolean;
  /** null 이면 즉시 발송. */
  scheduledAt: Date | null;
  isTest: boolean;
}

/** SendCampaignInput 의 발송 대상 토글 정규화 (미설정 = 세정 운영 기본값). */
function resolveSendTargets(input: SendCampaignInput): {
  sendToParent: boolean;
  sendToStudent: boolean;
} {
  return {
    sendToParent: input.sendToParent ?? true,
    sendToStudent: input.sendToStudent ?? false,
  };
}

/**
 * 발송 대상(그룹 | 필터)을 정규화한 해석 결과.
 *  - groupId: 그룹 기반. campaigns.group_id 에 저장.
 *  - filters/branch: 수신자 재조회 단일 소스. 그룹 기반이면 group.filters/branch.
 */
interface ResolvedTarget {
  /** 그룹 기반이면 그룹 id, 필터 기반이면 null (campaigns.group_id). */
  groupId: string | null;
  branch: string;
  filters: GroupFilters;
}

/**
 * 그룹 또는 필터 입력을 ResolvedTarget 으로 정규화.
 *  - filters+branch: getGroup 호출 없이 그대로 사용.
 *  - groupId: getGroup 으로 filters/branch 확정.
 */
async function resolveSendTarget(
  input: SendCampaignInput,
): Promise<{ ok: true; target: ResolvedTarget } | { ok: false; reason: string }> {
  if (input.filters && input.branch !== undefined) {
    return {
      ok: true,
      target: { groupId: null, branch: input.branch, filters: input.filters },
    };
  }
  if (input.groupId) {
    const group = await getGroup(input.groupId);
    if (!group) {
      return { ok: false, reason: "존재하지 않는 그룹입니다" };
    }
    return {
      ok: true,
      target: {
        groupId: group.id,
        branch: group.branch,
        filters: group.filters,
      },
    };
  }
  return { ok: false, reason: "발송 대상(그룹 또는 필터)이 지정되지 않았습니다" };
}

export type SendCampaignResult =
  | {
      status: "success";
      campaignId: string;
      /** 발송 큐에 적재된 메시지 수. 실제 발송은 백그라운드 워커가 진행한다. */
      sent: number;
      failed: number;
      cost: number;
    }
  | { status: "scheduled"; campaignId: string; scheduledAt: string }
  | { status: "blocked"; reason: string }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode"; reason: string };

/** messages 일괄 INSERT 청크. Supabase request size 한도 회피. */
const MESSAGES_INSERT_CHUNK = 1_000;
/** 한 번에 발송 허용 최대 인원. CLAUDE.md 발송 안전 가드. */
const MAX_RECIPIENTS_PER_CAMPAIGN = 100_000;

type SupabaseSrv = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export async function sendCampaign(
  input: SendCampaignInput,
): Promise<SendCampaignResult> {
  // 1) dev-seed 모드 차단 (DB 쓰기 불가)
  if (isDevSeedMode()) {
    return {
      status: "dev_seed_mode",
      reason: "개발 시드 모드에서는 실제 발송이 차단됩니다",
    };
  }

  // 2) 발송 대상(그룹 | 필터) 정규화 + 권한 검사
  const resolved = await resolveSendTarget(input);
  if (!resolved.ok) {
    return { status: "failed", reason: resolved.reason };
  }
  const target = resolved.target;

  const user = await getCurrentUser();
  if (!user) {
    return { status: "failed", reason: "로그인 후 이용 가능합니다" };
  }
  if (!can(user, "send", "campaign", target.branch)) {
    return {
      status: "failed",
      reason: "본 분원 캠페인 발송 권한이 없습니다",
    };
  }

  const targets = resolveSendTargets(input);

  // 3) 미리보기 (가드 적용 + 비용)
  let preview: PreviewResult;
  try {
    preview = await previewRecipients({
      filters: target.filters,
      branch: target.branch,
      body: input.body,
      isAd: input.isAd,
      type: input.type,
      dedupeByPhone: input.dedupeByPhone,
      sendToParent: targets.sendToParent,
      sendToStudent: targets.sendToStudent,
      scheduledAt: input.scheduledAt ?? new Date(),
    });
  } catch (e) {
    const reason =
      e instanceof Error ? e.message : "미리보기 산출에 실패했습니다";
    return { status: "failed", reason };
  }

  // 야간 광고 차단
  if (preview.blockedByQuietHours) {
    return {
      status: "blocked",
      reason: preview.blockReason ?? "야간 광고 차단 시간대입니다",
    };
  }

  // 수신자 0명 — 레그 확장 후 실제 발송 건수(actualMessages) 기준.
  // 학생만 발송인데 학생 번호가 전부 결측이면 targetStudents>0 이어도 0건일 수 있다.
  if (preview.dedupe.actualMessages === 0) {
    return { status: "failed", reason: "발송 가능한 수신자가 없습니다" };
  }

  // 발송 상한 — 큐에 적재되는 실제 발송 건수(레그 dedupe 후) 기준.
  // 학부모·학생 동시 발송 시 학생 수보다 건수가 많을 수 있어 actualMessages 로 본다.
  if (preview.dedupe.actualMessages > MAX_RECIPIENTS_PER_CAMPAIGN) {
    return {
      status: "failed",
      reason: `1회 발송 상한(${MAX_RECIPIENTS_PER_CAMPAIGN}건)을 초과했습니다`,
    };
  }

  const supabase = await createSupabaseServerClient();

  // 4) 발송 — 즉시(scheduledAt=null) / 예약(미래) 모두 동일 경로.
  //    예약이면 drain 이 sendon reservation 으로 접수하고 캠페인을 '예약됨' 마감.
  return await runImmediateSend({
    supabase,
    input,
    target,
    preview,
    userId: user.user_id,
    scheduledAt: input.scheduledAt,
  });
}

// ─── 즉시 발송 ──────────────────────────────────────────────

/**
 * 즉시 발송 흐름.
 *
 * Server Action 안에서 어댑터 호출까지 수행하면 60K 같은 대량 발송은 Vercel 함수
 * 타임아웃(300s) 을 초과한다. 따라서 본 함수는 큐 적재까지만 동기 처리하고,
 * 실제 발송은 `/api/messaging/drain` 워커가 자가호출 직렬로 청크씩 처리하도록 위임한다.
 *
 *   1. campaigns INSERT (status='발송중')
 *   2. messages INSERT (status='대기') — 1,000건 청크
 *   3. `next/server` after() 로 드레인 워커를 fire-and-forget 호출
 *   4. 즉시 응답 — UI 는 캠페인 상세에서 진행률을 폴링한다
 */
async function runImmediateSend(args: {
  supabase: SupabaseSrv;
  input: SendCampaignInput;
  target: ResolvedTarget;
  preview: PreviewResult;
  userId: string;
  /** 미래 시각이면 sendon 예약 발송(drain 이 reservation 으로 접수). null=즉시. */
  scheduledAt: Date | null;
}): Promise<SendCampaignResult> {
  const { supabase, input, target, preview, userId, scheduledAt } = args;
  void preview;
  const branch = target.branch;

  const targets = resolveSendTargets(input);

  // a) eligible 수신자 재조회 (preview 는 5명 샘플만 보존하므로)
  //    가드 통과 후 dedupeByPhone 이면 동일번호 collapse 까지 적용된 목록을 반환.
  //    레그 확장(학부모/학생) 도 여기서 적용된다.
  //    수신거부 수신자(unsubscribed)는 발송하지 않고 '실패(수신거부)' 행으로만 남긴다.
  const { eligible, unsubscribed } = await reloadEligibleRecipients({
    filters: target.filters,
    branch: target.branch,
    body: input.body,
    isAd: input.isAd,
    dedupeByPhone: input.dedupeByPhone,
    sendToParent: targets.sendToParent,
    sendToStudent: targets.sendToStudent,
    scheduledAt: scheduledAt ?? new Date(),
  });

  // eligible 이 0 이어도 수신거부 실패 행은 남길 가치가 있으나, 발송 가능한
  // 수신자가 전혀 없으면 preview 단(actualMessages===0)에서 이미 차단된다.
  // 여기 도달 시 eligible 0 + unsubscribed 0 조합만 진짜 빈 목록.
  if (eligible.length === 0 && unsubscribed.length === 0) {
    return { status: "failed", reason: "수신자 목록이 비었습니다" };
  }

  // 총 수신자 = 발송 시도(eligible) + 수신거부 실패 표시(unsubscribed).
  const totalRecipients = eligible.length + unsubscribed.length;

  // b) campaigns INSERT (status='발송중')
  const campaignInsert: Record<string, unknown> = {
    title: input.title,
    template_id: input.templateId,
    // 필터 기반 발송이면 null (그룹 미사용). excel-send 와 동일하게 NULL 허용.
    group_id: target.groupId,
    scheduled_at: scheduledAt ? scheduledAt.toISOString() : null,
    sent_at: scheduledAt ? null : new Date().toISOString(),
    status: "발송중",
    total_recipients: totalRecipients,
    total_cost: 0, // 드레인 워커가 누적 갱신
    created_by: userId,
    branch,
    is_test: input.isTest,
    body: input.body,
    subject: input.subject,
    type: input.type,
    is_ad: input.isAd,
    dedupe_by_phone: input.dedupeByPhone,
    send_to_parent: targets.sendToParent,
    send_to_student: targets.sendToStudent,
  };

  const insertedCampaign = await insertCampaign(supabase, campaignInsert);
  if (!insertedCampaign.ok) {
    return { status: "failed", reason: insertedCampaign.reason };
  }
  const campaignId = insertedCampaign.id;

  // c) messages 청크 INSERT (status='대기')
  // 60K 같은 대량을 단일 INSERT 로 보내면 Supabase request size 한도에 걸린다.
  for (let i = 0; i < eligible.length; i += MESSAGES_INSERT_CHUNK) {
    const slice = eligible.slice(i, i + MESSAGES_INSERT_CHUNK);
    const rows = slice.map((r) => ({
      campaign_id: campaignId,
      student_id: r.studentId,
      phone: r.phone,
      status: "대기",
      vendor_message_id: null,
      cost: 0,
      sent_at: null,
      delivered_at: null,
      failed_reason: null,
      is_test: input.isTest,
    }));

    const inserted = await insertMessages(supabase, rows);
    if (!inserted.ok) {
      await safeUpdateCampaignStatus(supabase, campaignId, "실패", 0);
      return { status: "failed", reason: inserted.reason };
    }
  }

  // c-2) 수신거부 수신자 → '실패(수신거부)' 행으로 즉시 INSERT.
  //   대기 단계를 거치지 않으므로 드레인 워커가 절대 발송하지 않는다.
  //   cost=0, sent_at=now, student_id 채워 캠페인 상세에 노출.
  //   (※ 이번 범위는 즉시 그룹 발송만. 예약/dispatch-broadcast/drain 미적용.)
  const nowIso = new Date().toISOString();
  for (let i = 0; i < unsubscribed.length; i += MESSAGES_INSERT_CHUNK) {
    const slice = unsubscribed.slice(i, i + MESSAGES_INSERT_CHUNK);
    const rows = slice.map((r) => ({
      campaign_id: campaignId,
      student_id: r.studentId,
      phone: r.phone,
      status: "실패",
      vendor_message_id: null,
      cost: 0,
      sent_at: nowIso,
      delivered_at: null,
      failed_reason: "수신거부",
      is_test: input.isTest,
    }));

    const inserted = await insertMessages(supabase, rows);
    if (!inserted.ok) {
      await safeUpdateCampaignStatus(supabase, campaignId, "실패", 0);
      return { status: "failed", reason: inserted.reason };
    }
  }

  // eligible 이 없고 수신거부만 있으면 드레인할 '대기' 행이 없다.
  // 캠페인을 '완료'로 마감하고 즉시 응답(전부 실패).
  if (eligible.length === 0) {
    await safeUpdateCampaignStatus(supabase, campaignId, "완료", 0);
    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${campaignId}`);
    return {
      status: "success",
      campaignId,
      sent: 0,
      failed: unsubscribed.length,
      cost: 0,
    };
  }

  // d) 드레인 워커 킥 — fire-and-forget. after() 는 응답 송출 후 실행되며
  //    Vercel 런타임이 promise 완료까지 함수 인스턴스 수명을 연장해준다.
  const drainSecret = process.env.DRAIN_SECRET;
  if (!drainSecret) {
    // 보안 가드: 시크릿 없으면 큐 적재까지만 완료하고 알려준다.
    // 운영 배포 전 반드시 설정해야 한다.
    await safeUpdateCampaignStatus(supabase, campaignId, "실패", 0);
    return {
      status: "failed",
      reason: "DRAIN_SECRET 환경변수가 설정되어 있지 않습니다",
    };
  }

  // Vercel runtime 에서 응답 송출 후에도 fetch 가 resolve 될 때까지 함수
  // 인스턴스 수명을 연장. next/server 의 after() 가 Next 16 + production
  // 조합에서 발사 안 되는 회귀가 관측되어 @vercel/functions/waitUntil 로 통일.
  // drain route 의 self-invoke 도 동일 API 를 쓰므로 운영상 일관성 ↑.
  waitUntil(
    fetch(`${getMessagingBaseUrl()}/api/messaging/drain`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-drain-secret": drainSecret,
      },
      body: JSON.stringify({ campaignId }),
      keepalive: true,
    }).catch(() => {
      // 첫 킥 실패는 무시 — 캠페인은 '발송중' 으로 남아있고,
      // 운영팀이 수동 재킥 또는 cron 으로 회복 가능.
    }),
  );

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${campaignId}`);

  // 예약 발송: drain 이 sendon reservation 으로 접수하고 캠페인을 '예약됨' 으로
  // 마감한다. 호출자(UI)에는 scheduled 결과를 돌려준다.
  if (scheduledAt) {
    return {
      status: "scheduled",
      campaignId,
      scheduledAt: scheduledAt.toISOString(),
    };
  }

  return {
    status: "success",
    campaignId,
    // 큐 적재 단계까지의 카운트. 실제 발송 결과는 캠페인 상세에서 확인.
    sent: eligible.length,
    // 수신거부는 발송 시도 없이 즉시 실패 행으로 적재되므로 failed 에 반영.
    failed: unsubscribed.length,
    cost: 0,
  };
}

// ─── eligible 수신자 재조회 (preview 와 동일 가드 적용) ─────────

interface EligibleRecipient {
  studentId: string | null;
  phone: string;
  name: string;
}

/**
 * 가드 통과 eligible 수신자 + 수신거부로 제외된 수신자.
 *
 * 수신거부자도 "실패(수신거부)" 메시지 행으로 남겨 캠페인에 보이게 하기 위해
 * 종전처럼 조용히 버리지 않고 분리해 반환한다. (탈퇴 제외는 기존대로 조용히 —
 * loadAllGroupRecipients 가 SQL 단에서 status='탈퇴' 를 거른다.)
 */
interface ReloadResult {
  eligible: EligibleRecipient[];
  /** 수신거부로 제외된 수신자. phone 기준 dedupe. 절대 발송되지 않음. */
  unsubscribed: EligibleRecipient[];
}

async function reloadEligibleRecipients(args: {
  filters: GroupFilters;
  branch: string;
  body: string;
  isAd: boolean;
  dedupeByPhone: boolean;
  sendToParent: boolean;
  sendToStudent: boolean;
  scheduledAt: Date;
}): Promise<ReloadResult> {
  if (isDevSeedMode()) {
    // dev-seed 는 실 발송이 차단되므로 본 함수가 도달할 일 없음. 안전망.
    return { eligible: [], unsubscribed: [] };
  }

  // 1) 후보 전체 일괄 수집 — loadRecipientsByFilters 가 SQL 단에서 분원·탈퇴 가드
  //    까지 처리(수신거부는 레그별이라 아래에서 적용). parent_phone·phone 둘 다 로드.
  const supabase = await createSupabaseServerClient();
  const [rows, unsubPhones] = await Promise.all([
    loadRecipientsByFilters(
      supabase,
      args.filters,
      args.branch,
      MAX_RECIPIENTS_PER_CAMPAIGN,
    ),
    getUnsubscribedPhones(),
  ]);

  // 2) 레그 확장 (학부모/학생) — 산출 순서 1단계.
  //    수신거부 제외를 여기서 하면 제외된 레그를 회수할 수 없으므로, 여기서는
  //    번호 결측만 스킵하고 수신거부는 아래에서 직접 분리(실패 행으로 남기기 위함).
  const allLegs = expandRecipientLegs(rows, {
    sendToParent: args.sendToParent,
    sendToStudent: args.sendToStudent,
    // unsubscribedPhones 미주입 → 레그 확장 단계에서 수신거부 미적용.
  });

  // 2-1) 수신거부 레그 분리 (정규화 비교). eligible 레그만 가드/dedupe 로 흘려보낸다.
  const unsubSet = new Set<string>(
    unsubPhones
      .map((p) => normalizeUnsubPhone(p))
      .filter((p): p is string => p !== null),
  );
  const eligibleLegs = allLegs.filter((l) => !unsubSet.has(l.phone));
  const unsubscribedLegs = allLegs.filter((l) => unsubSet.has(l.phone));

  // 고유 학생 수(사람 수) — eligible 레그 1개 이상 생성된 학생만 계수.
  //   (번호 결측/수신거부로 0레그가 된 학생은 제외 → 불변식 legs >= targetStudents 보장.)
  const targetStudents = countDistinctStudents(eligibleLegs);

  // 3) 본문 가드 (광고 prefix / 080 footer / 야간 차단) 만 추가 적용.
  //    탈퇴는 SQL 단, 수신거부는 위에서 분리했으므로 unsubscribedPhones 비워서 호출.
  const guarded = applyAllGuards({
    body: args.body,
    isAd: args.isAd,
    brand: branchBrandName(args.branch),
    scheduledAt: args.scheduledAt,
    recipients: eligibleLegs,
    unsubscribedPhones: [],
  });

  // 4) collapse — 가드 통과 직후, eligible 레그 배열에만 dedupe 적용.
  //    dedupeByPhone=false 면 입력 그대로(기존 동작 동일).
  //    loadAllGroupRecipients 가 registered_at DESC 순이므로 같은 번호 그룹의
  //    최상위(가장 최근 등록 학생)가 대표로 남는다.
  const { recipients } = collapseByPhone(
    guarded.eligible.map((r) => ({
      studentId: r.studentId,
      phone: r.phone,
      name: r.name,
    })),
    args.dedupeByPhone,
    targetStudents,
  );

  // 5) 수신거부 레그 phone 기준 dedupe (실패 행 중복 방지).
  const unsubscribed = dedupeByPhoneFirst(
    unsubscribedLegs.map((r) => ({
      studentId: r.studentId,
      phone: r.phone,
      name: r.name,
    })),
  );

  return { eligible: recipients, unsubscribed };
}

/** phone 기준 첫 등장만 유지하는 단순 dedupe (수신거부 실패 행용). */
function dedupeByPhoneFirst(
  recipients: EligibleRecipient[],
): EligibleRecipient[] {
  const seen = new Set<string>();
  const out: EligibleRecipient[] = [];
  for (const r of recipients) {
    if (seen.has(r.phone)) continue;
    seen.add(r.phone);
    out.push(r);
  }
  return out;
}

/** 하이픈 등 비숫자 제거. 빈 결과는 null. (수신거부 정규화 비교용) */
function normalizeUnsubPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

// ─── DB IO 헬퍼 (좁은 cast) ────────────────────────────────

type CampaignInsertReturn =
  | { ok: true; id: string }
  | { ok: false; reason: string };

async function insertCampaign(
  supabase: SupabaseSrv,
  payload: Record<string, unknown>,
): Promise<CampaignInsertReturn> {
  const { data, error } = await (
    supabase.from("crm_campaigns") as unknown as {
      insert: (v: Record<string, unknown>) => {
        select: (cols: string) => {
          single: () => Promise<{
            data: { id: string } | null;
            error: { message: string } | null;
          }>;
        };
      };
    }
  )
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    return { ok: false, reason: `캠페인 생성 실패: ${error.message}` };
  }
  if (!data) {
    return { ok: false, reason: "생성된 캠페인 ID 를 읽지 못했습니다" };
  }
  return { ok: true, id: data.id };
}

type MessagesInsertReturn =
  | { ok: true }
  | { ok: false; reason: string };

async function insertMessages(
  supabase: SupabaseSrv,
  rows: Record<string, unknown>[],
): Promise<MessagesInsertReturn> {
  // 즉시 발송 흐름은 드레인 워커가 messages 를 다시 SELECT 하므로
  // INSERT 응답에서 id/phone 회신을 받을 필요가 없다. select 생략으로
  // 6만건 대량 INSERT 의 응답 페이로드를 0 으로 줄인다.
  const { error } = await (
    supabase.from("crm_messages") as unknown as {
      insert: (v: Record<string, unknown>[]) => Promise<{
        error: { message: string } | null;
      }>;
    }
  ).insert(rows);

  if (error) {
    return { ok: false, reason: `메시지 큐 적재 실패: ${error.message}` };
  }
  return { ok: true };
}

async function safeUpdateCampaignStatus(
  supabase: SupabaseSrv,
  campaignId: string,
  status: "발송중" | "완료" | "실패" | "예약됨" | "취소" | "임시저장",
  totalCost: number,
): Promise<void> {
  await (
    supabase.from("crm_campaigns") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (
          col: string,
          val: string,
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )
    .update({ status, total_cost: totalCost })
    .eq("id", campaignId);
}
