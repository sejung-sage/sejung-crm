/**
 * 설명회 invitation 발송 디스패치 (0082).
 *
 * `createSeminarBroadcastAction` 이 학생당 invitation 을 만들고 학생 페이지 토큰을
 * 박은 본문을 sendon batch API 로 일괄 발송하기 위한 헬퍼.
 *
 * 일반 캠페인 발송(`send-campaign` + `drain-campaign`) 과의 차이:
 *  - 본문에 학생별 고유 URL (`/s/<link_token>`) 이 박힘 → 학생당 본문이 다름.
 *  - 따라서 sendon batch 의 단일 본문 1회 호출이 불가능 → 학생당 send() 또는
 *    `userParameters.replaces` 로 토큰 치환.
 *  - 본 구현은 **sendon batch + `userParameters.replaces`** 를 사용한다:
 *    본문에 `#{초대링크}` 자리표시를 박고, to 배열 각 수신자에게 그 학생의 URL 을
 *    name 슬롯으로 보낸다 (sendon 의 Replace 인터페이스는 dst=CONTACTS_MEMBER_NAME
 *    하나만 지원 — name 필드를 "URL 슬롯" 으로 재활용).
 *  - 단일 sendon 호출로 모든 학생에게 동시 적재 → 대량 발송 라운드트립 1회.
 *
 * 발송 안전:
 *  - 설명회 안내는 **정보성** 이므로 (광고) prefix / 080 footer / 야간 차단 없음.
 *  - 수신거부·탈퇴 학생 제외는 호출자(createSeminarBroadcastAction) 가 사전 필터링.
 *  - 발신번호는 환경변수(SENDON_FROM_NUMBER) — 어댑터 팩토리에서 주입.
 *  - 학부모 번호 로그는 마스킹.
 *
 * 결과:
 *  - 학생당 1행 crm_messages INSERT — student_id / phone / status / cost 채워서
 *    캠페인 통계가 일반 발송과 호환되도록.
 */

import { createSmsAdapter } from "@/lib/messaging/adapters";
import { calculateCost } from "@/lib/messaging/calculate-cost";
import { maskPhone } from "@/lib/phone";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SmsBatchRecipient } from "@/lib/messaging/adapters/types";

/** 학생당 발송 1건의 입력 묶음. */
export interface BroadcastRecipient {
  invitation_id: string;
  student_id: string;
  /** 학생 이름 (sendon Receiver.name 으로 채워질 수도 있음 — 본문에 `{이름}` 있을 때). */
  student_name: string;
  /** 학부모 전화 (숫자만 정규화된 11자리). */
  parent_phone: string;
  /** 학생 페이지 토큰 — `/s/<token>` 으로 본문에 박힘. */
  link_token: string;
}

export interface DispatchBroadcastInput {
  campaignId: string;
  recipients: BroadcastRecipient[];
  /**
   * 가드 통과·`{초대링크}` 자리표시 변환까지 끝난 최종 본문 템플릿.
   * sendon `replaces` 는 토큰 치환 `dst` 옵션이 CONTACTS_MEMBER_NAME 하나뿐이라
   * 본문엔 `#{이름}` 만 변환 placeholder 로 사용하고 학생별 URL 은
   * sendon `Receiver.name` 슬롯에 직접 박는다(아래 batch 호출 참조).
   */
  body: string;
  subject: string | null;
  type: "SMS" | "LMS";
  fromNumber: string;
  /**
   * 본문에 `{이름}` 자리표시가 있는지. 본 디스패치는 학생 페이지 URL 을 name 슬롯에
   * 박아 sendon Replace 1개를 소진하므로, {이름} 까지 동시에 치환할 수 없다.
   * Phase 0 에선 단순화 — `{이름}` 토큰은 호출자가 미리 `applyNameToken` 으로
   * 치환해서 본문에 박는다(학생당 본문이 어차피 다름).
   */
}

export interface DispatchBroadcastResult {
  sent: number;
  failed: number;
  totalCost: number;
  /** sendon 이 발급한 groupId — 학생당 messages.vendor_message_id 에 공유. */
  vendorMessageId: string | null;
  /** 실패 시 사유. status=failed 이면 NOT NULL. */
  failedReason: string | null;
}

/**
 * 학생별 메시지 1행씩 INSERT 후 sendon batch 1회 호출.
 * Vercel 함수 1회 안에서 ~수십~수백 명 처리 (대규모는 별도 드레인 워커로 옮길 것).
 *
 * 트랜잭션은 messages INSERT 까지만 묶고, 실제 벤더 호출은 INSERT 성공 후 수행.
 * 벤더 호출이 실패하면 INSERT 된 messages 의 status 를 '실패' 로 일괄 UPDATE.
 */
export async function dispatchBroadcast(
  supabase: SupabaseClient,
  input: DispatchBroadcastInput,
): Promise<DispatchBroadcastResult> {
  const { campaignId, recipients, body, subject, type, fromNumber } = input;

  if (recipients.length === 0) {
    return {
      sent: 0,
      failed: 0,
      totalCost: 0,
      vendorMessageId: null,
      failedReason: "수신자가 없습니다",
    };
  }

  // 1) 학생당 1행 messages INSERT (상태 '대기').
  //    vendor_message_id 는 sendon 응답 후 일괄 UPDATE.
  const nowIso = new Date().toISOString();
  const messageRows = recipients.map((r) => ({
    campaign_id: campaignId,
    student_id: r.student_id,
    phone: r.parent_phone,
    status: "대기" as const,
    vendor_message_id: null,
    cost: 0,
    sent_at: null,
    delivered_at: null,
    failed_reason: null,
    is_test: false,
    created_at: nowIso,
  }));

  // INSERT 시 id 와 phone 회수 — 발송 결과 매핑 + 마스킹 로그용.
  const inserted = await (
    supabase.from("crm_messages") as unknown as {
      insert: (v: Record<string, unknown>[]) => {
        select: (cols: string) => Promise<{
          data: Array<{ id: string; phone: string }> | null;
          error: { message: string } | null;
        }>;
      };
    }
  )
    .insert(messageRows)
    .select("id, phone");

  if (inserted.error) {
    return {
      sent: 0,
      failed: recipients.length,
      totalCost: 0,
      vendorMessageId: null,
      failedReason: `메시지 큐 적재 실패: ${inserted.error.message}`,
    };
  }
  const messageIds = (inserted.data ?? []).map((r) => r.id);

  // 2) sendon batch — 학생당 URL 을 sendon `Receiver.name` 슬롯에 박는다.
  //    본문은 `#{초대링크}` placeholder 를 사용하고 replaces 로 name 슬롯에 치환.
  const recipientsForBatch: SmsBatchRecipient[] = recipients.map((r) => ({
    phone: r.parent_phone,
    // sendon Replace 가 name 슬롯만 치환 가능 → URL 을 name 자리에 박는다.
    // 운영자 본문이 `{초대링크}` 를 안 쓰면 어차피 본문 끝에 URL 이 이미 박혀 있어
    // name 슬롯이 미사용으로 무해.
    name: buildInviteUrl(r.link_token),
  }));

  const adapter = createSmsAdapter();
  // sendon batch 어댑터는 `hasNamePlaceholder=true` 일 때 본문의 #{이름} 을
  // Receiver.name 으로 치환. 본 디스패치에선 본문에 `#{이름}` 대신 URL 토큰
  // `#{초대링크}` 를 사용하지만, sendon SDK 측 src 매칭은 정확한 토큰명을 사용해야 한다.
  // → 어댑터가 src='#{이름}' 으로 하드코딩되어 있으므로 본문에 `#{이름}` 으로 변환된
  //    placeholder 가 있어야 한다. 호출자(createSeminarBroadcastAction)가
  //    `{초대링크}` → `#{이름}` 으로 변환해 본문에 박아 보낸다.
  const sendBody = body;

  const batchResult = await adapter.sendBatch({
    to: recipientsForBatch,
    body: sendBody,
    subject,
    type,
    fromNumber,
    isAd: false, // 설명회 안내 = 정보성.
    hasNamePlaceholder: true,
  });

  // 3) 결과별 messages UPDATE.
  if (batchResult.status === "queued") {
    const totalCost = calculateCost(type, recipients.length).totalCost;
    const perRowCost = Math.round(batchResult.unitCost);
    await markMessagesSent(
      supabase,
      messageIds,
      batchResult.vendorMessageId,
      perRowCost,
      nowIso,
    );

    // 마스킹 로그 — 학부모 번호 평문 금지.
    console.log(
      `[seminars/dispatch] campaign=${campaignId} sent=${recipients.length} ` +
        `samples=${recipients.slice(0, 3).map((r) => maskPhone(r.parent_phone)).join(",")}`,
    );

    return {
      sent: recipients.length,
      failed: 0,
      totalCost,
      vendorMessageId: batchResult.vendorMessageId,
      failedReason: null,
    };
  }

  // 실패 → 일괄 '실패' UPDATE.
  await markMessagesFailed(
    supabase,
    messageIds,
    batchResult.reason,
    nowIso,
  );
  console.log(
    `[seminars/dispatch] campaign=${campaignId} failed=${recipients.length} reason=${batchResult.reason.slice(0, 80)}`,
  );
  return {
    sent: 0,
    failed: recipients.length,
    totalCost: 0,
    vendorMessageId: null,
    failedReason: batchResult.reason,
  };
}

/**
 * 학생 페이지 URL 구성. APP_BASE_URL / VERCEL_PROJECT_PRODUCTION_URL fallback 체인.
 * 본 함수가 반환하는 URL 이 학부모 SMS 본문에 박힌다.
 */
export function buildInviteUrl(token: string): string {
  const base = readPublicOrigin();
  return `${base}/s/${token}`;
}

function readPublicOrigin(): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

// ─── DB IO 헬퍼 (좁은 cast — send-campaign 패턴 미러) ────────

async function markMessagesSent(
  supabase: SupabaseClient,
  ids: string[],
  vendorMessageId: string,
  cost: number,
  sentAtIso: string,
): Promise<void> {
  if (ids.length === 0) return;
  // 일반 발송과 동일하게 단일 SQL UPDATE 로 끝내고 싶지만, RPC mark_messages_sent
  // 는 messages 일반 경로용 시그니처. 본 디스패치는 호출 빈도가 낮아 단순 UPDATE 로 충분.
  await (
    supabase.from("crm_messages") as unknown as {
      update: (v: Record<string, unknown>) => {
        in: (
          col: string,
          vals: string[],
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )
    .update({
      status: "발송됨",
      vendor_message_id: vendorMessageId,
      cost,
      sent_at: sentAtIso,
    })
    .in("id", ids);
}

/**
 * 메시지 UPDATE 시 `.in("id", ids)` 가 100개 넘어가면 PostgREST URL 한도(8KB,
 * Cloudflare) 초과로 414. 청크로 나눠 N번 호출.
 */
const MESSAGE_UPDATE_CHUNK = 100;

async function markMessagesFailed(
  supabase: SupabaseClient,
  ids: string[],
  reason: string,
  sentAtIso: string,
): Promise<void> {
  if (ids.length === 0) return;
  // failed_reason 컬럼은 길이 제한이 있을 수 있어 200자 컷 — 벤더 응답 그대로 보존하지만
  // log spam 방지 + DB row 부풀림 방지.
  const safeReason = reason.slice(0, 200);
  for (let i = 0; i < ids.length; i += MESSAGE_UPDATE_CHUNK) {
    const chunk = ids.slice(i, i + MESSAGE_UPDATE_CHUNK);
    await (
      supabase.from("crm_messages") as unknown as {
        update: (v: Record<string, unknown>) => {
          in: (
            col: string,
            vals: string[],
          ) => Promise<{ error: { message: string } | null }>;
        };
      }
    )
      .update({
        status: "실패",
        failed_reason: safeReason,
        sent_at: sentAtIso,
      })
      .in("id", chunk);
  }
}
