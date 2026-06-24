/**
 * 캠페인 드레인 워커.
 *
 * 한 캠페인의 status='대기' 메시지를 청크 단위로 발송한다. 한 청크는 1,000건
 * (PostgREST max_rows cap 동일), 한 호출 안에서 여러 청크를 time budget 안에서
 * 연속 처리해 Vercel 함수 1 호출로 최대 ~50K 건까지 처리한다.
 *
 * API route(`/api/messaging/drain`) 가 본 함수를 호출하고, 다 처리하지 못해
 * `hasMore=true` 가 돌아오면 자기 자신을 fire-and-forget 으로 재호출.
 *
 * 동작 (Vercel 300s 타임아웃 안):
 *   - 청크당: PostgREST `max_rows` = 1,000 으로 다음 '대기' 1,000건 fetch
 *   - 어댑터 호출: sendon batch API 1회 (1,000명을 1요청으로 적재)
 *   - DB UPDATE: mark_messages_sent / mark_messages_failed RPC 1회 (1,000건을
 *     단일 SQL UPDATE 로 일괄 갱신)
 *   - 한 청크 예상 처리 시간 ≈ 4~6초 (이전 20~30초)
 *   - MAX_BATCHES_PER_INVOCATION × ≈5초 ≤ TIME_BUDGET_MS 가 되도록 튜닝.
 *
 * 왜 한 호출에서 여러 청크를 처리하는가:
 *   self-invocation chain (waitUntil + keepalive) 이 Vercel 환경에서 일정
 *   횟수 이상 연속되면 끊기는 회귀 발견 (2026-05-13 60K 캠페인이 4 청크만에
 *   정지). 한 호출이 더 많이 처리할수록 chain 호출 횟수가 줄어 안정적이고,
 *   "이어보내기" 버튼/sweep 도 1회 호출로 더 많은 분량을 복구할 수 있다.
 *
 * 동시성:
 *   - 같은 캠페인을 두 인스턴스가 동시에 드레인하면 같은 메시지가 두 번 발송될 수 있다.
 *   - 현재 운영은 self-invocation 직렬 (이전 청크가 끝나야 다음 청크 호출) → 충돌 위험 낮음.
 *   - 강한 원자성이 필요하면 RPC SQL 함수에서 FOR UPDATE SKIP LOCKED 로 가져와야 함 (Phase 1).
 *
 * 권한:
 *   - service role 클라이언트 사용. RLS 우회. 호출자(API route) 에서 인증 확인.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { createSmsAdapter } from "./adapters";
import type { SmsBatchRecipient } from "./adapters/types";
import {
  insertSenderHeader,
  insertAdSubjectTag,
  branchBrandName,
} from "./guards/insert-ad-tag";
import { insertUnsubscribeFooter } from "./guards/insert-unsubscribe-footer";
import { calculateCost } from "./calculate-cost";
import {
  applyDateToken,
  hasNameToken,
  toSendonNameSyntax,
} from "./personalize";
import {
  buildInviteUrl,
  INVITE_LINK_TOKEN,
  SENDON_INVITE_PLACEHOLDER,
} from "@/lib/seminars/dispatch-broadcast";
import { sendonFromNumber } from "@/config/sender-numbers";
import { isSlackEnabled } from "@/lib/notify/slack";
import type {
  CampaignRow,
  CampaignStatus,
  TemplateType,
} from "@/types/database";

/** PostgREST max_rows cap. 한 fetchPending 가 가져오는 '대기' 메시지 수 = 한 batch
 *  sendon 호출의 수신자 수. */
export const DRAIN_CHUNK_SIZE = 1_000;
/** 한 drain 호출에서 처리할 최대 청크 수. 25청크 × 1,000건 = 25,000건. */
const MAX_BATCHES_PER_INVOCATION = 25;
/** 한 drain 호출의 sendon 발송 작업 time budget. Vercel maxDuration=300s 의 60%.
 *  실 운영에서 청크당 평균 ~8초 (sendon batch + RPC UPDATE) × 25청크 = 200초.
 *  240s 로 두면 마지막 청크 처리 중 300s timeout 에 정확히 걸려 chain kick
 *  자체가 발사되지 않는 회귀(2026-05-13 31K 처리 후 timeout) 가 발생함.
 *  남은 120s 는 응답 송출 / waitUntil(fetch) / Vercel 내부 cleanup 마진. */
const TIME_BUDGET_MS = 180_000;

type SrvClient = SupabaseClient;

export interface DrainChunkResult {
  campaignId: string;
  /** 본 호출에서 발송 시도한 메시지 수 */
  attempted: number;
  /** 본 호출에서 성공한 메시지 수 */
  sent: number;
  /** 본 호출에서 실패한 메시지 수 */
  failed: number;
  /** 본 청크 이후에도 '대기' 메시지가 남았는지 */
  hasMore: boolean;
  /** 본 호출에서 누적된 비용 (campaigns.total_cost 에 이미 반영됨) */
  addedCost: number;
  /** 캠페인 최종 상태가 본 호출에서 마감되었는지 */
  campaignDone: boolean;
}

/**
 * 설명회 발송 본문에 학생별 신청 URL 자리(sendon name 슬롯)를 만든다.
 *  - 본문에 {초대링크} 가 있으면 그 자리를 #{이름} 로 전부 치환.
 *  - 없으면 본문 끝에 "신청: #{이름}" 을 부착.
 * createSeminarBroadcastAction 의 finalBody 합성과 동일 규칙(순수 함수, 테스트용 export).
 */
export function applyInviteLinkToken(body: string): string {
  return body.includes(INVITE_LINK_TOKEN)
    ? body.split(INVITE_LINK_TOKEN).join(SENDON_INVITE_PLACEHOLDER)
    : `${body}\n\n신청: ${SENDON_INVITE_PLACEHOLDER}`;
}

export async function drainCampaignChunk(
  campaignId: string,
): Promise<DrainChunkResult> {
  const supabase = createSupabaseServiceClient();

  // 1) 캠페인 로드 + 상태 검증
  const campaign = await loadCampaign(supabase, campaignId);
  if (campaign.status !== "발송중") {
    return doneResult(campaignId);
  }
  if (!campaign.body || !campaign.type) {
    await updateCampaignStatus(supabase, campaignId, "실패");
    throw new Error("캠페인 body/type 누락 — 발송 불가");
  }

  // 2) 본문 가드 + 어댑터 + 발신번호 (반복 호출 전 1회만 준비)
  //    {날짜} 는 모든 수신자에게 동일 — finalBody 단계에서 1회 치환.
  //    {이름} 은 수신자별 다름 — sendon batch + userParameters 로 벤더 측 치환.
  //                            → 본문은 sendon 문법 #{이름} 으로 변환만 한다.
  //    날짜 기준: scheduled_at > sent_at > now() (예약 발송분도 발송 당일 KST 로 출력).
  const personalizationDate =
    parseDateOrNull(campaign.scheduled_at) ??
    parseDateOrNull(campaign.sent_at) ??
    new Date();

  // 예약 발송(sendon 네이티브) — scheduled_at 이 미래면 sendon reservation 으로
  // 접수한다. 이 경우 우리는 발송을 진행하지 않고 sendon 이 그 시각에 발송하며,
  // 캠페인은 '완료' 가 아니라 '예약됨' 으로 마감한다(우리 cron 은 발송하지 않음).
  const reservationDatetime =
    campaign.scheduled_at &&
    new Date(campaign.scheduled_at).getTime() > Date.now()
      ? new Date(campaign.scheduled_at).toISOString()
      : undefined;

  // 초대링크 모드 — 설명회 발송(createSeminarBroadcastAction)이 적재한 캠페인은
  // 학생별 고유 신청 URL 을 sendon name 슬롯에 박는다. campaign.body 토큰에
  // 의존하지 않고 "이 캠페인에 invitation 이 있는가"로 판정한다(그룹/엑셀 발송은
  // invitation 이 없어 자동으로 일반 경로 → 회귀 안전).
  const inviteMode = await hasInvitations(supabase, campaignId);
  const inviteUrlMap = inviteMode
    ? await loadInviteUrlMap(supabase, campaignId)
    : null;

  let hasName: boolean;
  let sendBody: string;
  // 발신 브랜드명 — 캠페인 분원 기준(대치="세정학원", 그 외="{분원} 세정학원").
  const brand = branchBrandName(campaign.branch);
  if (inviteMode) {
    // {초대링크} → #{이름}(sendon name 슬롯). 없으면 "신청: #{이름}" 부착 —
    // createSeminarBroadcastAction 의 finalBody 합성과 동일 규칙.
    const withPlaceholder = applyInviteLinkToken(campaign.body);
    sendBody = applyDateToken(
      insertUnsubscribeFooter(
        insertSenderHeader(withPlaceholder, campaign.is_ad, brand),
        campaign.is_ad,
      ),
      personalizationDate,
    );
    hasName = true; // name 슬롯 사용(값은 학생 이름이 아니라 초대 URL)
  } else {
    const guardedBody = applyDateToken(
      insertUnsubscribeFooter(
        insertSenderHeader(campaign.body, campaign.is_ad, brand),
        campaign.is_ad,
      ),
      personalizationDate,
    );
    hasName = hasNameToken(guardedBody);
    // 본문은 hasName 일 때만 sendon 치환 문법으로 변환 — 외 경우 그대로 송출.
    sendBody = hasName ? toSendonNameSyntax(guardedBody) : guardedBody;
  }
  const adapter = createSmsAdapter(campaign.branch);
  // 분원별 발신번호 — 캠페인 분원 기준(미설정 분원은 SENDON_FROM_NUMBER 폴백).
  const fromNumber = readFromNumber(adapter.name, campaign.branch);
  if (!fromNumber) {
    await updateCampaignStatus(supabase, campaignId, "실패");
    throw new Error("발신번호 환경변수가 설정되어 있지 않습니다");
  }
  const type = campaign.type as TemplateType;

  // 3) 본 호출에서 누적 카운트
  let totalAttempted = 0;
  let totalSent = 0;
  let totalFailed = 0;
  let totalAddedCost = 0;
  const t0 = Date.now();

  // 4) 청크 루프 — time budget / MAX_BATCHES 가 다 차면 break, 그 외엔 끝까지
  for (let batchIdx = 0; batchIdx < MAX_BATCHES_PER_INVOCATION; batchIdx += 1) {
    if (Date.now() - t0 > TIME_BUDGET_MS) break;

    const pending = await fetchPending(supabase, campaignId);
    if (pending.length === 0) break; // 더 처리할 게 없음

    const result = await processOneBatch({
      supabase,
      pending,
      adapter,
      sendBody,
      subject: insertAdSubjectTag(campaign.subject, campaign.is_ad),
      type,
      fromNumber,
      isAd: campaign.is_ad,
      campaignId,
      hasName,
      inviteMode,
      inviteUrlMap,
      reservationDatetime,
    });
    totalAttempted += result.attempted;
    totalSent += result.sent;
    totalFailed += result.failed;
    totalAddedCost += result.addedCost;
  }

  // 5) 남은 '대기' 있는지 확인 → hasMore 결정
  const hasMore = await hasPending(supabase, campaignId);

  let campaignDone = false;
  if (!hasMore) {
    // 즉시: 발송 결과로 완료/실패.
    // 예약(sendon reservation): 접수 성공분이 있으면 '예약됨'(아직 발송 전),
    // 전부 접수 실패면 '실패'. (30분 미만 등 sendon 거절 시 '실패' 로 드러남)
    const base = await determineFinalStatus(supabase, campaignId);
    const finalStatus = reservationDatetime
      ? base === "완료"
        ? "예약됨"
        : "실패"
      : base;
    await updateCampaignStatus(supabase, campaignId, finalStatus);
    campaignDone = true;

    // 발송/예약 접수 완료 후 5분 뒤 sendon 실패 점검을 예약한다. 그때 cron 이 이
    // 캠페인만 콕 집어 (DB 실패 + sendon 비동기 실패)를 확인해 있으면 Slack 1회 알림.
    // sendon 실패(포인트 부족 등)는 접수 직후 비동기로 찍혀 지금은 알 수 없으므로 지연.
    // Slack 미설정이면 예약도 생략.
    if (isSlackEnabled()) {
      await scheduleSendonCheck(supabase, campaignId);
    }
  }

  return {
    campaignId,
    attempted: totalAttempted,
    sent: totalSent,
    failed: totalFailed,
    hasMore,
    addedCost: totalAddedCost,
    campaignDone,
  };
}

/**
 * 한 청크(최대 1,000건) 처리.
 *
 * 흐름:
 *   - hasName=false → 단순 string[] to 로 sendon batch 1회.
 *   - hasName=true  → student_id → name 매핑 후 to 를 Array<{phone, name}> 으로
 *                     구성, body 는 이미 `#{이름}` 으로 변환된 상태로 전달.
 *                     userParameters 트리거(`hasNamePlaceholder=true`) 도 함께.
 *
 * 어느 쪽이든 sendon API 1회 호출 + 단일 RPC UPDATE. vendor_message_id 는
 * 한 groupId 가 N건 공유 — 기존 batch 경로와 동일.
 *
 * drainCampaignChunk 의 루프 안에서 반복 호출된다.
 */
async function processOneBatch(args: {
  supabase: SrvClient;
  pending: PendingRow[];
  adapter: ReturnType<typeof createSmsAdapter>;
  sendBody: string;
  subject: string | null;
  type: TemplateType;
  fromNumber: string;
  isAd: boolean;
  campaignId: string;
  hasName: boolean;
  /** 초대링크 모드 — name 슬롯에 학생 이름 대신 신청 페이지 URL 을 박는다. */
  inviteMode: boolean;
  /** 초대링크 모드일 때 student_id → 신청 URL 맵 (drainCampaignChunk 가 1회 로드). */
  inviteUrlMap: Map<string, string> | null;
  /** 예약 발송 시각(ISO). 있으면 sendon reservation 으로 접수(즉시 발송 X). */
  reservationDatetime?: string;
}): Promise<{
  attempted: number;
  sent: number;
  failed: number;
  addedCost: number;
}> {
  const {
    supabase,
    pending,
    adapter,
    sendBody,
    subject,
    type,
    fromNumber,
    isAd,
    campaignId,
    hasName,
    inviteMode,
    inviteUrlMap,
    reservationDatetime,
  } = args;

  const nowIso = new Date().toISOString();
  const ids = pending.map((p) => p.id);
  let sent = 0;
  let failed = 0;
  let addedCost = 0;

  // name 슬롯 채우기:
  //  - 초대링크 모드 → 학생별 신청 URL (inviteUrlMap).
  //  - 일반 {이름} 모드 → 학생 이름 (없으면 '학부모님').
  //  - 둘 다 아니면 매핑 불필요 (string[] 경로).
  let recipients: SmsBatchRecipient[] | null = null;
  if (inviteMode) {
    const map = inviteUrlMap ?? new Map<string, string>();
    recipients = pending.map((p) => ({
      phone: p.phone,
      // URL 누락 시(있을 수 없는 케이스) name 빈값 — sendon 측 빈 치환. 경고만.
      name: (p.student_id ? map.get(p.student_id) ?? "" : "") || "",
    }));
    const missing = recipients.filter((r) => r.name === "").length;
    if (missing > 0) {
      console.warn(
        `[drain] 초대링크 누락 ${missing}건 (campaign=${campaignId}) — 토큰 매핑 확인 필요`,
      );
    }
  } else if (hasName) {
    const studentIds = Array.from(
      new Set(
        pending
          .map((p) => p.student_id)
          .filter((v): v is string => typeof v === "string" && v.length > 0),
      ),
    );
    const nameMap = await loadStudentNames(supabase, studentIds);
    recipients = pending.map((p) => ({
      phone: p.phone,
      name:
        (p.student_id ? nameMap.get(p.student_id) ?? "" : "").trim() ||
        "학부모님",
    }));
  }

  const batchResult = await adapter.sendBatch({
    to: recipients ?? pending.map((p) => p.phone),
    body: sendBody,
    subject,
    type,
    fromNumber,
    isAd,
    hasNamePlaceholder: hasName,
    reservationDatetime,
  });

  if (batchResult.status === "queued") {
    // 한 batch 의 N건이 같은 vendor_message_id 를 공유 → 단일 RPC 로 일괄 UPDATE.
    sent = pending.length;
    const totalCost = calculateCost(type, pending.length).totalCost;
    addedCost = totalCost;
    const perRowCost = Math.round(batchResult.unitCost);
    await markMessagesSent(
      supabase,
      ids,
      batchResult.vendorMessageId,
      perRowCost,
      nowIso,
    );
  } else {
    // batch 전체 실패 — 동일 사유로 일괄 UPDATE.
    failed = pending.length;
    await markMessagesFailed(supabase, ids, batchResult.reason, nowIso);
  }

  if (addedCost > 0) {
    await incrementCampaignCost(supabase, campaignId, addedCost);
  }

  return { attempted: pending.length, sent, failed, addedCost };
}

async function loadStudentNames(
  supabase: SrvClient,
  studentIds: string[],
): Promise<Map<string, string>> {
  if (studentIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("crm_students")
    .select("id, name")
    .in("id", studentIds);

  if (error) {
    // 이름 조회 실패해도 발송 자체는 진행 (fallback '학부모님') — 발송 정지보다 안전.
    return new Map();
  }
  const rows = (data ?? []) as Array<{ id: string; name: string | null }>;
  const out = new Map<string, string>();
  for (const r of rows) {
    if (r.name) out.set(r.id, r.name);
  }
  return out;
}

/**
 * 이 캠페인이 설명회 초대 발송인지 — invitation 행 존재 여부로 판정.
 * head+count 로 1행도 안 읽고 존재만 확인. (그룹/엑셀 발송은 0 → false.)
 */
async function hasInvitations(
  supabase: SrvClient,
  campaignId: string,
): Promise<boolean> {
  const { count, error } = await supabase
    .from("crm_class_signup_invitations")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId);
  if (error) return false;
  return (count ?? 0) > 0;
}

/**
 * 초대링크 모드용 student_id → 신청 페이지 URL 맵.
 *
 * `.in("student_id", ids)` 는 1,000개 UUID 가 Cloudflare 8KB URL 한도를 넘겨
 * 414 가 나므로, campaign_id 로만 필터하고 range 페이지네이션(1,000행)으로
 * 캠페인의 모든 invitation 을 끌어와 맵을 만든다. drainCampaignChunk 가 1회만 호출.
 */
async function loadInviteUrlMap(
  supabase: SrvClient,
  campaignId: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const PAGE = 1_000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("crm_class_signup_invitations")
      .select("student_id, link_token")
      .eq("campaign_id", campaignId)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) break;
    const rows = (data ?? []) as Array<{
      student_id: string | null;
      link_token: string | null;
    }>;
    for (const r of rows) {
      if (r.student_id && r.link_token) {
        out.set(r.student_id, buildInviteUrl(r.link_token));
      }
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

function parseDateOrNull(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

interface PendingRow {
  id: string;
  phone: string;
  student_id: string | null;
}

// ─── 헬퍼 ──────────────────────────────────────────────────

function doneResult(campaignId: string): DrainChunkResult {
  return {
    campaignId,
    attempted: 0,
    sent: 0,
    failed: 0,
    hasMore: false,
    addedCost: 0,
    campaignDone: true,
  };
}

async function loadCampaign(
  supabase: SrvClient,
  campaignId: string,
): Promise<CampaignRow> {
  const { data, error } = await supabase
    .from("crm_campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();

  if (error) throw new Error(`캠페인 조회 실패: ${error.message}`);
  if (!data) throw new Error(`존재하지 않는 캠페인: ${campaignId}`);
  return data as CampaignRow;
}

async function fetchPending(
  supabase: SrvClient,
  campaignId: string,
): Promise<PendingRow[]> {
  const { data, error } = await supabase
    .from("crm_messages")
    .select("id, phone, student_id")
    .eq("campaign_id", campaignId)
    .eq("status", "대기")
    .order("id", { ascending: true })
    .limit(DRAIN_CHUNK_SIZE);

  if (error) throw new Error(`대기 메시지 조회 실패: ${error.message}`);
  return (data ?? []) as PendingRow[];
}

async function hasPending(
  supabase: SrvClient,
  campaignId: string,
): Promise<boolean> {
  const { count, error } = await supabase
    .from("crm_messages")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", "대기");

  if (error) throw new Error(`남은 대기 카운트 실패: ${error.message}`);
  return (count ?? 0) > 0;
}

async function determineFinalStatus(
  supabase: SrvClient,
  campaignId: string,
): Promise<"완료" | "실패"> {
  // 발송됨이 1건이라도 있으면 '완료' (부분 실패 포함). 전부 실패면 '실패'.
  const { count: okCount, error } = await supabase
    .from("crm_messages")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", "발송됨");

  if (error) throw new Error(`최종 상태 산출 실패: ${error.message}`);
  return (okCount ?? 0) > 0 ? "완료" : "실패";
}

/** 발송 완료 후 sendon 실패 점검까지의 지연(분). 비동기 실패가 찍힐 시간을 준다. */
const SENDON_CHECK_DELAY_MIN = 5;

/**
 * 발송 완료 캠페인에 'N분 뒤 sendon 실패 점검' 예약을 건다.
 * sendon_check_due_at 에 미래 시각을 찍어두면 cron 이 그 시각 이후 한 번 점검한다.
 */
async function scheduleSendonCheck(
  supabase: SrvClient,
  campaignId: string,
): Promise<void> {
  const dueAt = new Date(
    Date.now() + SENDON_CHECK_DELAY_MIN * 60_000,
  ).toISOString();
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
    .update({ sendon_check_due_at: dueAt })
    .eq("id", campaignId);
}

/**
 * mark_messages_sent RPC 호출 — 한 batch 의 N건을 단일 SQL UPDATE 로 갱신.
 * PostgREST 라운드트립 N → 1.
 */
async function markMessagesSent(
  supabase: SrvClient,
  ids: string[],
  vendorMessageId: string,
  cost: number,
  sentAtIso: string,
): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await (
    supabase as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: number | null; error: { message: string } | null }>;
    }
  ).rpc("mark_messages_sent", {
    p_ids: ids,
    p_vendor_message_id: vendorMessageId,
    p_cost: cost,
    p_sent_at: sentAtIso,
  });
  if (error) {
    throw new Error(`mark_messages_sent RPC 실패: ${error.message}`);
  }
}

/**
 * mark_messages_failed RPC 호출 — batch 전체 실패 케이스를 단일 UPDATE 로 갱신.
 */
async function markMessagesFailed(
  supabase: SrvClient,
  ids: string[],
  failedReason: string,
  sentAtIso: string,
): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await (
    supabase as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: number | null; error: { message: string } | null }>;
    }
  ).rpc("mark_messages_failed", {
    p_ids: ids,
    p_failed_reason: failedReason,
    p_sent_at: sentAtIso,
  });
  if (error) {
    throw new Error(`mark_messages_failed RPC 실패: ${error.message}`);
  }
}

async function updateCampaignStatus(
  supabase: SrvClient,
  campaignId: string,
  status: CampaignStatus,
): Promise<void> {
  await (
    supabase.from("crm_campaigns") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (
          c: string,
          v: string,
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )
    .update({ status })
    .eq("id", campaignId);
}

async function incrementCampaignCost(
  supabase: SrvClient,
  campaignId: string,
  added: number,
): Promise<void> {
  // race 발생 가능하나 self-invocation 직렬이라 위험 낮음. 강한 원자성 필요 시 RPC 로 이전.
  const { data } = await supabase
    .from("crm_campaigns")
    .select("total_cost")
    .eq("id", campaignId)
    .maybeSingle();

  const cur = (data as { total_cost?: number } | null)?.total_cost ?? 0;
  await (
    supabase.from("crm_campaigns") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (
          c: string,
          v: string,
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )
    .update({ total_cost: Math.round(cur + added) })
    .eq("id", campaignId);
}

function readFromNumber(
  adapterName: string,
  branch?: string | null,
): string | null {
  switch (adapterName) {
    case "sendon":
      return sendonFromNumber(branch);
    default:
      return null;
  }
}

