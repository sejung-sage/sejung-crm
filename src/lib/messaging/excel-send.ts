/**
 * F3 · "엑셀 보내기" 발송 코어.
 *
 * 업로드 파싱(xlsx → 행 배열)은 frontend 가 끝낸 상태로 들어온다. 이 코어는
 * 서버 측 재검증 + 발송 안전 가드 + 캠페인/메시지 기록 + 실제 발송을 담당한다.
 * DB 스키마 변경 없음 — crm_campaigns(group_id NULL 허용, test-send 가 이미
 * 그렇게 씀) · crm_messages 재사용.
 *
 * 처리 순서:
 *   1) dev-seed 차단 → 인증(getCurrentUser) → 권한(can send campaign 본인 분원).
 *   2) ExcelSendInputSchema 로 서버 재검증.
 *   3) phone 숫자 정규화 → 휴대폰 정규식 검증. 잘못된 번호는 제외(skippedInvalid).
 *   4) 동일 번호 1회(dedupe) — 첫 행의 name 유지(deduped).
 *   5) applyAllGuards — 야간 광고 차단 / 수신거부 분리(수신거부는 발송 안 하고
 *      '실패(수신거부)' 행으로 기록, send-campaign 와 동일 규칙).
 *   6) 캠페인 INSERT (group_id=null, is_test=false, title 자동).
 *   7) eligible → '대기' INSERT 후 발송 / 수신거부 → '실패' INSERT.
 *   8) 발송: 수신자별 본문 = applyNameToken(applyDateToken(가드본문, now), name).
 *      resend-failed 처럼 SEND_BATCH 청크로 adapter.send 호출(평문 개인화).
 *   9) 메시지 update + 캠페인 비용/상태 갱신. skipped 카운트 포함 반환.
 *
 * 관찰성: 학부모 번호는 DB 에 raw 저장(UI 가 마스킹 책임). 실패 사유는 벤더 응답
 * 그대로 messages.failed_reason 에 기록.
 */

import { revalidatePath } from "next/cache";
import { createSmsAdapter } from "./adapters";
import { applyAllGuards, branchBrandName, type Recipient } from "./guards";
import { applyDateToken, applyNameToken } from "./personalize";
import { calculateCost } from "./calculate-cost";
import { exceedsLimit } from "./sms-bytes";
import { getUnsubscribedPhones } from "./unsubscribed-phones";
import {
  readFromNumber,
  extractFailedReason,
  updateMessage,
  safeUpdateCampaignStatus,
  incrementCampaignCost,
} from "./message-update-helpers";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/can";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  ExcelSendInputSchema,
  type ExcelSendInput,
} from "@/lib/schemas/excel-send";
import type { SendCampaignResult } from "./send-campaign";

/** 한 번에 어댑터로 보낼 발송 배치 크기. resend-failed 와 동일. */
const SEND_BATCH_SIZE = 100;
/** messages 일괄 INSERT 청크. Supabase request size 한도 회피. */
const MESSAGES_INSERT_CHUNK = 1_000;
/** 휴대폰 번호(숫자만) 형식. test-send / send-campaign 과 동일 정규식. */
const PHONE_PATTERN = /^01[016789][0-9]{7,8}$/;

type SupabaseSrv = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** 엑셀 보내기 발송 결과. send 요약 + 프론트 표시용 skip 카운트. */
export type ExcelSendResult = SendCampaignResult & {
  /** 휴대폰 형식 위반으로 제외된 행 수(발송/기록 안 함). */
  skippedInvalid: number;
  /** 수신거부로 '실패' 처리된 수신자 수. */
  skippedUnsub: number;
  /** 동일 번호 dedupe 로 합쳐진(제거된) 행 수. */
  deduped: number;
};

/** 내부 발송 후보. studentId 는 엑셀 발송에선 항상 null. */
interface ExcelRecipientNormalized {
  phone: string;
  name: string;
}

export async function excelSend(
  input: ExcelSendInput,
): Promise<ExcelSendResult> {
  // 1) dev-seed 차단
  if (isDevSeedMode()) {
    return withSkips(
      { status: "dev_seed_mode", reason: "개발 시드 모드에서는 실제 발송이 차단됩니다" },
      { skippedInvalid: 0, skippedUnsub: 0, deduped: 0 },
    );
  }

  // 인증
  const user = await getCurrentUser();
  if (!user) {
    return withSkips(
      { status: "failed", reason: "로그인 후 이용 가능합니다" },
      { skippedInvalid: 0, skippedUnsub: 0, deduped: 0 },
    );
  }
  // 권한 — 본인 분원 캠페인 발송.
  if (!can(user, "send", "campaign", user.branch)) {
    return withSkips(
      { status: "failed", reason: "본 분원 캠페인 발송 권한이 없습니다" },
      { skippedInvalid: 0, skippedUnsub: 0, deduped: 0 },
    );
  }

  // 2) 서버 재검증 (클라 검증과 별개로 신뢰 경계에서 한 번 더)
  const parsed = ExcelSendInputSchema.safeParse(input);
  if (!parsed.success) {
    const first =
      parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다";
    return withSkips(
      { status: "failed", reason: first },
      { skippedInvalid: 0, skippedUnsub: 0, deduped: 0 },
    );
  }
  const data = parsed.data;
  // LMS 가 아니면 subject 무시.
  const subject = data.type === "LMS" ? data.subject : null;

  // 3) phone 정규화 + 휴대폰 형식 검증. 잘못된 번호 제외(skippedInvalid).
  const valid: ExcelRecipientNormalized[] = [];
  let skippedInvalid = 0;
  for (const r of data.recipients) {
    const phone = r.phone.replace(/\D/g, "");
    if (!PHONE_PATTERN.test(phone)) {
      skippedInvalid += 1;
      continue;
    }
    valid.push({ phone, name: r.name.trim() });
  }

  if (valid.length === 0) {
    return withSkips(
      { status: "failed", reason: "보낼 수 있는 올바른 번호가 없습니다" },
      { skippedInvalid, skippedUnsub: 0, deduped: 0 },
    );
  }

  // 4) 동일 번호 1회 dedupe — 첫 행의 name 유지.
  const seen = new Set<string>();
  const deduped: ExcelRecipientNormalized[] = [];
  for (const r of valid) {
    if (seen.has(r.phone)) continue;
    seen.add(r.phone);
    deduped.push(r);
  }
  const dedupedCount = valid.length - deduped.length;

  // 5) 발송 안전 가드 — 본문 변환(광고/footer) + 야간 차단 + 수신거부 분리.
  let unsubscribedPhones: string[];
  try {
    unsubscribedPhones = await getUnsubscribedPhones();
  } catch (e) {
    return withSkips(
      {
        status: "failed",
        reason:
          e instanceof Error ? e.message : "수신거부 목록 조회에 실패했습니다",
      },
      { skippedInvalid, skippedUnsub: 0, deduped: dedupedCount },
    );
  }

  const recipients: Recipient[] = deduped.map((r) => ({
    studentId: null,
    phone: r.phone,
    name: r.name,
    status: "재원생",
  }));

  const guarded = applyAllGuards({
    body: data.body,
    isAd: data.isAd,
    brand: branchBrandName(user.branch),
    scheduledAt: new Date(),
    recipients,
    unsubscribedPhones,
  });

  // 야간 광고 차단.
  if (!guarded.allowedToSend) {
    return withSkips(
      {
        status: "blocked",
        reason: guarded.blockReason ?? "야간 광고 차단 시간대입니다",
      },
      { skippedInvalid, skippedUnsub: 0, deduped: dedupedCount },
    );
  }

  // eligible = 발송 대상. excluded(reason='수신거부') = '실패' 기록 대상.
  const eligible: ExcelRecipientNormalized[] = guarded.eligible.map((r) => ({
    phone: r.phone,
    name: r.name,
  }));
  const unsubscribed: ExcelRecipientNormalized[] = guarded.excluded
    .filter((e) => e.reason === "수신거부")
    .map((e) => ({ phone: e.recipient.phone, name: e.recipient.name }));

  if (eligible.length === 0 && unsubscribed.length === 0) {
    return withSkips(
      { status: "failed", reason: "발송 가능한 수신자가 없습니다" },
      { skippedInvalid, skippedUnsub: 0, deduped: dedupedCount },
    );
  }

  const supabase = await createSupabaseServerClient();
  const totalRecipients = eligible.length + unsubscribed.length;

  // 6) 캠페인 INSERT (group_id=null, is_test=false, title 자동)
  const campaignInsert: Record<string, unknown> = {
    title: `[엑셀] ${shortenForTitle(data.body)}`,
    template_id: null,
    group_id: null,
    scheduled_at: null,
    sent_at: new Date().toISOString(),
    status: "발송중",
    total_recipients: totalRecipients,
    total_cost: 0,
    created_by: user.user_id,
    branch: user.branch,
    is_test: false,
    body: data.body,
    subject,
    type: data.type,
    is_ad: data.isAd,
  };

  const insertedCampaign = await insertCampaign(supabase, campaignInsert);
  if (!insertedCampaign.ok) {
    return withSkips(
      { status: "failed", reason: insertedCampaign.reason },
      { skippedInvalid, skippedUnsub: unsubscribed.length, deduped: dedupedCount },
    );
  }
  const campaignId = insertedCampaign.id;

  // 7-a) 수신거부 → '실패(수신거부)' 행 INSERT (발송 안 함, cost=0).
  const nowIso = new Date().toISOString();
  for (let i = 0; i < unsubscribed.length; i += MESSAGES_INSERT_CHUNK) {
    const slice = unsubscribed.slice(i, i + MESSAGES_INSERT_CHUNK);
    const rows = slice.map((r) => ({
      campaign_id: campaignId,
      student_id: null,
      phone: r.phone,
      status: "실패",
      vendor_message_id: null,
      cost: 0,
      sent_at: nowIso,
      delivered_at: null,
      failed_reason: "수신거부",
      is_test: false,
    }));
    const ins = await insertMessages(supabase, rows);
    if (!ins.ok) {
      await safeUpdateCampaignStatus(supabase, campaignId, "실패");
      return withSkips(
        { status: "failed", reason: ins.reason },
        {
          skippedInvalid,
          skippedUnsub: unsubscribed.length,
          deduped: dedupedCount,
        },
      );
    }
  }

  // eligible 이 없으면(전원 수신거부) 캠페인 마감 후 즉시 응답.
  if (eligible.length === 0) {
    await safeUpdateCampaignStatus(supabase, campaignId, "완료");
    revalidatePath("/campaigns");
    revalidatePath(`/campaigns/${campaignId}`);
    return withSkips(
      {
        status: "success",
        campaignId,
        sent: 0,
        failed: unsubscribed.length,
        cost: 0,
      },
      {
        skippedInvalid,
        skippedUnsub: unsubscribed.length,
        deduped: dedupedCount,
      },
    );
  }

  // 7-b) eligible → '대기' 행 INSERT. id/phone 을 회신받아 발송 후 update 매핑.
  const queued = await insertEligibleMessages(supabase, campaignId, eligible);
  if (!queued.ok) {
    await safeUpdateCampaignStatus(supabase, campaignId, "실패");
    return withSkips(
      { status: "failed", reason: queued.reason },
      {
        skippedInvalid,
        skippedUnsub: unsubscribed.length,
        deduped: dedupedCount,
      },
    );
  }

  // 8) 발송 — 어댑터/발신번호 준비. 분원별 발신번호(엑셀발송은 본인 분원 기준).
  const adapter = createSmsAdapter();
  const fromNumber = readFromNumber(adapter.name, user.branch);
  if (!fromNumber) {
    await safeUpdateCampaignStatus(supabase, campaignId, "실패");
    return withSkips(
      {
        status: "failed",
        reason: "발신번호 환경변수가 설정되어 있지 않습니다",
      },
      {
        skippedInvalid,
        skippedUnsub: unsubscribed.length,
        deduped: dedupedCount,
      },
    );
  }

  // 날짜 토큰은 모든 수신자 동일 → 1회 미리 치환.
  const datedBody = applyDateToken(guarded.finalBody, new Date());
  const unitCost = calculateCost(data.type, 1).totalCost;

  let sentOk = 0;
  let failed = 0;
  let addedCost = 0;

  const items = queued.rows;
  for (let i = 0; i < items.length; i += SEND_BATCH_SIZE) {
    const batch = items.slice(i, i + SEND_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((m) => {
        // 수신자별 평문 개인화 ({이름} 치환).
        const body = applyNameToken(datedBody, m.name);
        return adapter.send({
          to: m.phone,
          body,
          subject,
          type: data.type,
          fromNumber,
          isAd: data.isAd,
        });
      }),
    );

    for (let j = 0; j < batch.length; j += 1) {
      const m = batch[j];
      if (!m) continue;
      const sr = results[j];
      const ts = new Date().toISOString();

      // 발송 직전 바이트 한도 재검증 — 토큰 치환 후 길이가 한도를 넘으면 실패.
      const finalBody = applyNameToken(datedBody, m.name);
      if (exceedsLimit(finalBody, data.type)) {
        failed += 1;
        await updateMessage(supabase, m.id, {
          status: "실패",
          failed_reason: `본문 바이트 한도(${data.type}) 초과`,
          sent_at: ts,
        });
        continue;
      }

      if (sr && sr.status === "fulfilled" && sr.value.status === "queued") {
        sentOk += 1;
        addedCost += unitCost;
        await updateMessage(supabase, m.id, {
          status: "발송됨",
          vendor_message_id: sr.value.vendorMessageId,
          cost: Math.round(unitCost),
          sent_at: ts,
          failed_reason: null,
        });
      } else {
        failed += 1;
        await updateMessage(supabase, m.id, {
          status: "실패",
          failed_reason: extractFailedReason(sr),
          sent_at: ts,
        });
      }
    }
  }

  // 9) 캠페인 비용/상태 갱신.
  await incrementCampaignCost(supabase, campaignId, addedCost);
  // eligible 전부 실패면 '실패', 아니면 '완료'(부분 실패 포함).
  await safeUpdateCampaignStatus(
    supabase,
    campaignId,
    sentOk === 0 ? "실패" : "완료",
  );

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${campaignId}`);

  return withSkips(
    {
      status: "success",
      campaignId,
      sent: sentOk,
      // 발송 실패 + 수신거부 실패 합산.
      failed: failed + unsubscribed.length,
      cost: addedCost,
    },
    {
      skippedInvalid,
      skippedUnsub: unsubscribed.length,
      deduped: dedupedCount,
    },
  );
}

// ─── 내부 헬퍼 ──────────────────────────────────────────────

/** SendCampaignResult 에 skip 카운트 3종을 합쳐 ExcelSendResult 로 변환. */
function withSkips(
  base: SendCampaignResult,
  skips: { skippedInvalid: number; skippedUnsub: number; deduped: number },
): ExcelSendResult {
  return { ...base, ...skips };
}

/** 캠페인 제목용 본문 앞 20자 추출. */
function shortenForTitle(body: string): string {
  const first = body.split("\n")[0]?.trim() ?? "";
  if (first.length === 0) return "엑셀 발송";
  if (first.length <= 20) return first;
  return `${first.slice(0, 20)}...`;
}

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

type MessagesInsertReturn = { ok: true } | { ok: false; reason: string };

/** 수신거부 '실패' 행 등 회신 불필요한 일괄 INSERT (select 생략). */
async function insertMessages(
  supabase: SupabaseSrv,
  rows: Record<string, unknown>[],
): Promise<MessagesInsertReturn> {
  if (rows.length === 0) return { ok: true };
  const { error } = await (
    supabase.from("crm_messages") as unknown as {
      insert: (v: Record<string, unknown>[]) => Promise<{
        error: { message: string } | null;
      }>;
    }
  ).insert(rows);
  if (error) {
    return { ok: false, reason: `메시지 적재 실패: ${error.message}` };
  }
  return { ok: true };
}

interface QueuedMessage {
  id: string;
  phone: string;
  name: string;
}

type EligibleInsertReturn =
  | { ok: true; rows: QueuedMessage[] }
  | { ok: false; reason: string };

/**
 * eligible '대기' 행 INSERT. 발송 후 결과 매핑을 위해 id/phone 회신.
 * 청크별 INSERT...returning 으로 id 를 받아 name 과 다시 합친다.
 * (엑셀 발송은 최대 5,000명이라 회신 페이로드가 과하지 않다.)
 */
async function insertEligibleMessages(
  supabase: SupabaseSrv,
  campaignId: string,
  eligible: ExcelRecipientNormalized[],
): Promise<EligibleInsertReturn> {
  const out: QueuedMessage[] = [];
  for (let i = 0; i < eligible.length; i += MESSAGES_INSERT_CHUNK) {
    const slice = eligible.slice(i, i + MESSAGES_INSERT_CHUNK);
    const rows = slice.map((r) => ({
      campaign_id: campaignId,
      student_id: null,
      phone: r.phone,
      status: "대기",
      vendor_message_id: null,
      cost: 0,
      sent_at: null,
      delivered_at: null,
      failed_reason: null,
      is_test: false,
    }));

    const { data, error } = await (
      supabase.from("crm_messages") as unknown as {
        insert: (v: Record<string, unknown>[]) => {
          select: (cols: string) => Promise<{
            data: { id: string; phone: string }[] | null;
            error: { message: string } | null;
          }>;
        };
      }
    )
      .insert(rows)
      .select("id, phone");

    if (error) {
      return { ok: false, reason: `메시지 큐 적재 실패: ${error.message}` };
    }
    const inserted = data ?? [];
    if (inserted.length !== slice.length) {
      return {
        ok: false,
        reason: "메시지 적재 결과 수가 입력과 일치하지 않습니다",
      };
    }
    // returning 순서는 INSERT 입력 순서를 따른다 → 인덱스로 name 결합.
    for (let k = 0; k < inserted.length; k += 1) {
      const row = inserted[k];
      const src = slice[k];
      if (!row || !src) continue;
      out.push({ id: row.id, phone: row.phone, name: src.name });
    }
  }
  return { ok: true, rows: out };
}
