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
import { applyAllGuards, type Recipient } from "./guards";
import { collapseByPhone } from "./dedupe-recipients";
import { getMessagingBaseUrl } from "./base-url";
import { getGroup } from "@/lib/groups/get-group";
import { loadAllGroupRecipients } from "@/lib/groups/load-all-group-recipients";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/can";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface SendCampaignInput {
  title: string;
  groupId: string;
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
  /** null 이면 즉시 발송. */
  scheduledAt: Date | null;
  isTest: boolean;
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

  // 2) 그룹 + 권한 검사
  const group = await getGroup(input.groupId);
  if (!group) {
    return { status: "failed", reason: "존재하지 않는 그룹입니다" };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { status: "failed", reason: "로그인 후 이용 가능합니다" };
  }
  if (!can(user, "send", "campaign", group.branch)) {
    return {
      status: "failed",
      reason: "본 분원 캠페인 발송 권한이 없습니다",
    };
  }

  // 3) 미리보기 (가드 적용 + 비용)
  let preview: PreviewResult;
  try {
    preview = await previewRecipients({
      groupId: input.groupId,
      body: input.body,
      isAd: input.isAd,
      type: input.type,
      dedupeByPhone: input.dedupeByPhone,
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

  // 수신자 0명
  if (preview.recipientCount === 0) {
    return { status: "failed", reason: "발송 가능한 수신자가 없습니다" };
  }

  // 발송 상한
  if (preview.recipientCount > MAX_RECIPIENTS_PER_CAMPAIGN) {
    return {
      status: "failed",
      reason: `1회 발송 상한(${MAX_RECIPIENTS_PER_CAMPAIGN}건)을 초과했습니다`,
    };
  }

  const supabase = await createSupabaseServerClient();

  // 4) 예약 발송 처리 (campaigns 만 INSERT)
  if (input.scheduledAt !== null) {
    return await insertScheduledCampaign({
      supabase,
      input,
      branch: group.branch,
      preview,
      userId: user.user_id,
    });
  }

  // 5) 즉시 발송
  return await runImmediateSend({
    supabase,
    input,
    branch: group.branch,
    preview,
    userId: user.user_id,
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
  branch: string;
  preview: PreviewResult;
  userId: string;
}): Promise<SendCampaignResult> {
  const { supabase, input, branch, preview, userId } = args;
  void preview;

  // a) eligible 수신자 재조회 (preview 는 5명 샘플만 보존하므로)
  //    가드 통과 후 dedupeByPhone 이면 동일번호 collapse 까지 적용된 목록을 반환.
  const eligible = await reloadEligibleRecipients({
    groupId: input.groupId,
    body: input.body,
    isAd: input.isAd,
    dedupeByPhone: input.dedupeByPhone,
    scheduledAt: new Date(),
  });

  if (eligible.length === 0) {
    return { status: "failed", reason: "수신자 목록이 비었습니다" };
  }

  // b) campaigns INSERT (status='발송중')
  const campaignInsert: Record<string, unknown> = {
    title: input.title,
    template_id: input.templateId,
    group_id: input.groupId,
    scheduled_at: null,
    sent_at: new Date().toISOString(),
    status: "발송중",
    total_recipients: eligible.length,
    total_cost: 0, // 드레인 워커가 누적 갱신
    created_by: userId,
    branch,
    is_test: input.isTest,
    body: input.body,
    subject: input.subject,
    type: input.type,
    is_ad: input.isAd,
    dedupe_by_phone: input.dedupeByPhone,
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

  return {
    status: "success",
    campaignId,
    // 큐 적재 단계까지의 카운트. 실제 발송 결과는 캠페인 상세에서 확인.
    sent: eligible.length,
    failed: 0,
    cost: 0,
  };
}

// ─── 예약 발송 ──────────────────────────────────────────────

async function insertScheduledCampaign(args: {
  supabase: SupabaseSrv;
  input: SendCampaignInput;
  branch: string;
  preview: PreviewResult;
  userId: string;
}): Promise<SendCampaignResult> {
  const { supabase, input, branch, preview, userId } = args;
  const scheduledAt = input.scheduledAt;
  if (!scheduledAt) {
    return { status: "failed", reason: "예약 시각이 비어 있습니다" };
  }

  // 0027 마이그 후 발송 payload 를 같이 영속화 — cron 디스패처가 이걸 읽어 발송.
  const insertPayload: Record<string, unknown> = {
    title: input.title,
    template_id: input.templateId,
    group_id: input.groupId,
    scheduled_at: scheduledAt.toISOString(),
    sent_at: null,
    status: "예약됨",
    total_recipients: preview.recipientCount,
    total_cost: 0,
    created_by: userId,
    branch,
    is_test: input.isTest,
    body: input.body,
    subject: input.subject,
    type: input.type,
    is_ad: input.isAd,
    dedupe_by_phone: input.dedupeByPhone,
  };

  const inserted = await insertCampaign(supabase, insertPayload);
  if (!inserted.ok) {
    return { status: "failed", reason: inserted.reason };
  }

  revalidatePath("/campaigns");
  return {
    status: "scheduled",
    campaignId: inserted.id,
    scheduledAt: scheduledAt.toISOString(),
  };
}

// ─── eligible 수신자 재조회 (preview 와 동일 가드 적용) ─────────

interface EligibleRecipient {
  studentId: string | null;
  phone: string;
  name: string;
}

async function reloadEligibleRecipients(args: {
  groupId: string;
  body: string;
  isAd: boolean;
  dedupeByPhone: boolean;
  scheduledAt: Date;
}): Promise<EligibleRecipient[]> {
  if (isDevSeedMode()) {
    // dev-seed 는 실 발송이 차단되므로 본 함수가 도달할 일 없음. 안전망.
    return [];
  }

  // 1) 후보 전체 일괄 수집 — loadAllGroupRecipients 가 SQL 단에서 분원·탈퇴·수신거부
  //    가드까지 처리. 60K 기준 8~10 쿼리로 완료 (이전: 약 5,000 쿼리).
  const supabase = await createSupabaseServerClient();
  const rows = await loadAllGroupRecipients(
    supabase,
    args.groupId,
    MAX_RECIPIENTS_PER_CAMPAIGN,
  );

  const collected: Recipient[] = [];
  for (const r of rows) {
    if (!r.parent_phone) continue;
    collected.push({
      studentId: r.id,
      phone: r.parent_phone.replace(/\D/g, ""),
      name: r.name,
      // loadAllGroupRecipients 가 탈퇴를 SQL 단에서 제외하므로 안전
      status: r.status,
    });
  }

  // 2) 본문 가드 (광고 prefix / 080 footer / 야간 차단) 만 추가 적용.
  //    수신거부·탈퇴는 위에서 이미 제외됐으므로 unsubscribedPhones 비워서 호출.
  const guarded = applyAllGuards({
    body: args.body,
    isAd: args.isAd,
    scheduledAt: args.scheduledAt,
    recipients: collected,
    unsubscribedPhones: [],
  });

  // 3) collapse — 가드 통과 직후, eligible 배열에만 dedupe 적용.
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
  );

  return recipients;
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
