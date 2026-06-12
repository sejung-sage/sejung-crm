/**
 * F3 Part B · 개별 학생 1명 재발송.
 *
 * 박은주 부원장 요청: 기존 "실패 건 일괄 재발송"(`resend-failed`) 외에, 특정 학생
 * 1명만 콕 집어 재발송하는 단건 경로. 일괄 버전 로직을 1건으로 좁힌 형태이며,
 * 가드/어댑터/비용 계산은 동일 패턴을 공유한다(공용 헬퍼는 message-update-helpers).
 *
 * 동작:
 *   1) dev-seed 모드 차단.
 *   2) messageId 검증 → crm_messages 단건 조회(id 기준). 없으면 실패.
 *   3) 상태 가드:
 *      - is_test=true  → 차단(테스트 메시지는 재발송 불가).
 *      - status '대기'  → 차단(발송 중/큐 적재 상태 — 중복 발송 방지).
 *      - status '도달'  → 차단(도달 추적 미구현이라 사실상 안 오지만 안전 차단).
 *      - status '실패'/'발송됨' → 허용.
 *   4) campaign_id → getCampaign → 권한 can(user,'send','campaign',branch).
 *   5) 본문 확보: 캠페인 스냅샷(body/subject/type/is_ad)을 그대로 재사용.
 *      템플릿 기반/직접 작성 본문 구분 없음. body/type 가 NULL 인 옛 캠페인만 차단.
 *   6) 가드 재적용(applyAllGuards): 그 1건 recipient 에 수신거부 + 야간광고 차단.
 *      이후 {날짜}/{이름} 토큰을 단건 경로(applyDateToken/applyNameToken)로 치환.
 *   7) 어댑터 발송 → 그 메시지 행 update + incrementCampaignCost.
 *      캠페인 status 는 단건 재발송으로 흔들지 않는다(아래 NOTE 참조).
 *   8) revalidatePath('/campaigns'), revalidatePath(`/campaigns/${campaignId}`).
 *
 * NOTE — 캠페인 status 미변경:
 *   일괄 재발송은 다수 건을 다시 큐에 넣는 의미라 캠페인을 '발송중'으로 전이했다가
 *   '완료/실패'로 닫는다. 반면 단건 재발송은 이미 닫힌(완료/실패) 캠페인에서 한 행만
 *   손보는 행위이므로 캠페인 전체 상태를 '발송중'으로 흔드는 건 부자연스럽다(상세
 *   진행률 폴링·리스트 배지가 잠깐 '발송중'으로 보이는 혼란). 따라서 캠페인 status 는
 *   그대로 두고 total_cost 만 누적한다.
 */

import { revalidatePath } from "next/cache";
import { createSmsAdapter } from "./adapters";
import { applyAllGuards, insertAdSubjectTag, type Recipient } from "./guards";
import { calculateCost } from "./calculate-cost";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/can";
import { getCampaign } from "@/lib/campaigns/get-campaign";
import { getUnsubscribedPhones } from "./unsubscribed-phones";
import { applyDateToken, applyNameToken } from "./personalize";
import { buildInviteUrl } from "@/lib/seminars/dispatch-broadcast";
import type { SendCampaignResult } from "./send-campaign";

/** 설명회 본문의 초대링크 자리표시. seminars/actions.ts 의 INVITE_TOKEN 과 동일. */
const INVITE_TOKEN = "{초대링크}";
import {
  readFromNumber,
  extractFailedReason,
  updateMessage,
  incrementCampaignCost,
} from "./message-update-helpers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** 단건 조회 시 읽어오는 crm_messages 행 형태. */
interface MessageRow {
  id: string;
  campaign_id: string | null;
  phone: string;
  student_id: string | null;
  status: string;
  is_test: boolean;
}

export async function resendSingleMessage(
  messageId: string,
): Promise<SendCampaignResult> {
  // 1) dev-seed 모드 차단 (DB 쓰기 불가)
  if (isDevSeedMode()) {
    return {
      status: "dev_seed_mode",
      reason: "개발 시드 모드에서는 실제 재발송이 차단됩니다",
    };
  }

  if (!messageId || typeof messageId !== "string") {
    return { status: "failed", reason: "메시지 ID 가 유효하지 않습니다" };
  }

  const supabase = await createSupabaseServerClient();

  // 2) 메시지 단건 조회
  const { data: row, error: fetchError } = await supabase
    .from("crm_messages")
    .select("id, campaign_id, phone, student_id, status, is_test")
    .eq("id", messageId)
    .maybeSingle();

  if (fetchError) {
    return {
      status: "failed",
      reason: `메시지 조회에 실패했습니다: ${fetchError.message}`,
    };
  }
  if (!row) {
    return { status: "failed", reason: "존재하지 않는 메시지입니다" };
  }

  const message = row as MessageRow;

  // 3) 상태 가드 — 중복 발송 방지 + 테스트 보호
  if (message.is_test) {
    return {
      status: "failed",
      reason: "테스트 메시지는 재발송할 수 없습니다",
    };
  }
  if (message.status === "대기") {
    return {
      status: "failed",
      reason: "발송 중인 메시지는 재발송할 수 없습니다",
    };
  }
  if (message.status === "도달") {
    // 우리 시스템은 도달 추적 미구현이라 사실상 도달 상태는 오지 않지만,
    // 정상 도달분을 다시 쏘는 사고를 막기 위해 안전하게 차단한다.
    return {
      status: "failed",
      reason: "이미 도달한 메시지는 재발송할 수 없습니다",
    };
  }
  if (message.status !== "실패" && message.status !== "발송됨") {
    // 위 가드를 빠져나온 알 수 없는 상태는 보수적으로 차단.
    return {
      status: "failed",
      reason: "현재 상태의 메시지는 재발송할 수 없습니다",
    };
  }

  if (!message.campaign_id) {
    return {
      status: "failed",
      reason: "캠페인 정보가 없어 재발송할 수 없습니다",
    };
  }
  const campaignId = message.campaign_id;

  // 4) 캠페인 조회 + 권한
  const campaign = await getCampaign(campaignId);
  if (!campaign) {
    return { status: "failed", reason: "존재하지 않는 캠페인입니다" };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { status: "failed", reason: "로그인 후 이용 가능합니다" };
  }
  if (!can(user, "send", "campaign", campaign.branch)) {
    return {
      status: "failed",
      reason: "본 분원 캠페인 발송 권한이 없습니다",
    };
  }

  // 5) 본문 확보 — 캠페인이 body/subject/type/is_ad 를 직접 들고 있으므로
  //    템플릿 기반/직접 작성 본문 구분 없이 캠페인 스냅샷을 그대로 재사용한다.
  //    (0027 이전 옛 캠페인은 body/type 가 NULL 일 수 있어 방어 차단.)
  if (!campaign.body || !campaign.type) {
    return {
      status: "failed",
      reason: "본문 정보가 없는 옛 캠페인은 재발송할 수 없습니다",
    };
  }
  const campaignBody = campaign.body;
  const campaignType = campaign.type;

  // {이름} 치환용 학생 이름 — 단건 발송은 sendon batch(userParameters) 가 아니라
  // applyNameToken 으로 앱에서 직접 치환한다(test-send 와 동일). 학생 미연결·조회
  // 실패 시 applyNameToken 의 '학부모님' fallback 이 적용된다.
  let studentName: string | null = null;
  if (message.student_id) {
    const { data: stu } = await supabase
      .from("crm_students")
      .select("name")
      .eq("id", message.student_id)
      .maybeSingle();
    studentName = (stu as { name?: string } | null)?.name ?? null;
  }

  // 6) 가드 재적용 — 그 1건에도 수신거부 + 야간 광고 차단을 동일하게 강제.
  let unsubscribedPhones: string[];
  try {
    unsubscribedPhones = await getUnsubscribedPhones();
  } catch (e) {
    return {
      status: "failed",
      reason:
        e instanceof Error ? e.message : "수신거부 목록 조회에 실패했습니다",
    };
  }

  const normalizedPhone = message.phone.replace(/\D/g, "");
  const recipients: Recipient[] = [
    {
      studentId: message.student_id,
      phone: normalizedPhone,
      name: studentName ?? "",
      status: "재원생",
    },
  ];

  const guarded = applyAllGuards({
    body: campaignBody,
    isAd: campaign.is_ad,
    scheduledAt: new Date(),
    recipients,
    unsubscribedPhones,
  });

  if (!guarded.allowedToSend) {
    return {
      status: "blocked",
      reason: guarded.blockReason ?? "야간 광고 차단 시간대입니다",
    };
  }
  if (guarded.eligible.length === 0) {
    return {
      status: "failed",
      reason: "재발송 가능한 수신자가 없습니다(수신거부)",
    };
  }

  const recipient = guarded.eligible[0];
  if (!recipient) {
    return {
      status: "failed",
      reason: "재발송 가능한 수신자가 없습니다(수신거부)",
    };
  }

  // 7) 개인화 토큰 치환(단건) — test-send 와 동일 순서.
  //    {날짜} → 캠페인 기준일(scheduled_at > sent_at > now)을 KST 'M월 D일' 로
  //             치환해 원문 발송일을 그대로 재현. {이름} → 학생 이름(없으면 학부모님).
  const personalizationDate =
    parseDateOrNull(campaign.scheduled_at) ??
    parseDateOrNull(campaign.sent_at) ??
    new Date();
  let personalizedBody = applyNameToken(
    applyDateToken(guarded.finalBody, personalizationDate),
    studentName,
  );

  // 7-2) 설명회 초대링크 치환 — 본문에 {초대링크} 가 있으면(설명회 캠페인) 이 학생의
  //      기존 invitation(원 발송 때 생성, campaign_id 로 연결) 토큰을 찾아 실제 URL 로
  //      바꾼다. 최초 발송은 sendon name-slot 으로 학생별 URL 을 박았지만, 단건
  //      재발송은 batch 가 아니라 평문 1건이라 여기서 직접 치환해야 한다(안 하면
  //      "{초대링크}" 글자가 그대로 전송됨).
  if (personalizedBody.includes(INVITE_TOKEN) && message.student_id) {
    const inviteUrl = await resolveInviteUrl(
      supabase,
      campaignId,
      message.student_id,
    );
    if (inviteUrl) {
      personalizedBody = personalizedBody.split(INVITE_TOKEN).join(inviteUrl);
    }
  }

  // 8) 어댑터 발송
  const adapter = createSmsAdapter();
  const fromNumber = readFromNumber(adapter.name);
  if (!fromNumber) {
    return {
      status: "failed",
      reason: "발신번호 환경변수가 설정되어 있지 않습니다",
    };
  }

  const sr = await Promise.allSettled([
    adapter.send({
      to: recipient.phone,
      body: personalizedBody,
      subject: insertAdSubjectTag(campaign.subject, campaign.is_ad),
      type: campaignType,
      fromNumber,
      isAd: campaign.is_ad,
    }),
  ]).then((arr) => arr[0]);

  const nowIso = new Date().toISOString();
  let sentOk = 0;
  let failed = 0;
  let addedCost = 0;

  if (sr && sr.status === "fulfilled" && sr.value.status === "queued") {
    sentOk = 1;
    const unitCost = calculateCost(campaignType, 1).totalCost;
    addedCost = unitCost;
    // messages.cost INT — 소수 단가는 round 후 저장(합산은 float 으로 보존).
    await updateMessage(supabase, message.id, {
      status: "발송됨",
      vendor_message_id: sr.value.vendorMessageId,
      cost: Math.round(unitCost),
      sent_at: nowIso,
      failed_reason: null,
    });
  } else {
    failed = 1;
    const reason = extractFailedReason(sr);
    await updateMessage(supabase, message.id, {
      status: "실패",
      failed_reason: reason,
      sent_at: nowIso,
    });
  }

  // 캠페인 누적 비용만 갱신. 캠페인 status 는 의도적으로 건드리지 않는다(상단 NOTE).
  await incrementCampaignCost(supabase, campaignId, addedCost);

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${campaignId}`);

  return {
    status: "success",
    campaignId,
    sent: sentOk,
    failed,
    cost: addedCost,
  };
}

/**
 * 이 학생이 해당 캠페인에서 받은 초대 링크 URL 을 복원한다.
 * crm_class_signup_invitations 에서 (campaign_id, student_id) 로 link_token 을 찾아
 * buildInviteUrl 로 합성. 매칭 invitation 이 없으면(옛 캠페인 등) null.
 */
async function resolveInviteUrl(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  campaignId: string,
  studentId: string,
): Promise<string | null> {
  // 1) campaign + student 정확 매칭 (원 발송 때 만든 invitation).
  const exact = await fetchLatestToken(supabase, studentId, campaignId);
  if (exact) return buildInviteUrl(exact);

  // 2) 폴백 — 이 학생의 가장 최근 invitation(캠페인 무관). 옛 캠페인이 dedupe/버그로
  //    이 학생 invitation 을 campaign_id 로 안 남겼어도, 학생 페이지 링크는 제공.
  const fallback = await fetchLatestToken(supabase, studentId, null);
  return fallback ? buildInviteUrl(fallback) : null;
}

/** 학생(+선택적 campaign)의 최신 invitation link_token. 없으면 null. */
async function fetchLatestToken(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  studentId: string,
  campaignId: string | null,
): Promise<string | null> {
  let q = supabase
    .from("crm_class_signup_invitations")
    .select("link_token")
    .eq("student_id", studentId);
  if (campaignId) q = q.eq("campaign_id", campaignId);
  const { data, error } = await q
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as { link_token?: string } | null)?.link_token ?? null;
}

/** ISO 문자열을 Date 로. null/파싱 실패 시 null. (drain-campaign 와 동일 헬퍼.) */
function parseDateOrNull(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
