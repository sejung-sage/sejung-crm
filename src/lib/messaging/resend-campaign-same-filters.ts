/**
 * 같은 조건으로 다시 보내기 — 캠페인의 발송 조건·본문을 그대로 재사용해
 * **새 캠페인**을 만든다 (0121).
 *
 * "실패 건 재발송"(resend-failed) 과의 차이:
 *   - resend-failed : crm_messages 중 status='실패' 인 *행* 을 다시 보낸다.
 *                     큐 적재 전에 죽어 메시지 행이 0건이면 보낼 대상이 없다.
 *   - 이 함수        : 저장된 필터로 수신자를 **다시 조회**해 처음부터 보낸다.
 *                     그래서 메시지 행이 0건이어도 동작한다.
 *
 * 기존 캠페인 행은 건드리지 않는다 — 실패 이력을 그대로 남기고 새 캠페인을 만든다.
 *
 * 안전:
 *   - 실제 발송은 sendCampaign 을 그대로 태운다. 권한·야간 광고 차단·수신거부 제외·
 *     바이트 한도 등 모든 가드가 첫 발송과 동일하게 재적용된다.
 *   - send_filters 는 DB JSON 이라 GroupFiltersSchema 로 Zod 재검증 후 사용한다.
 *   - 이미 발송이 끝난('완료') 캠페인은 중복 발송 위험이 커 차단한다. 실패·취소 건만
 *     허용(UI 도 같은 조건으로 버튼을 숨긴다).
 */

import { getCampaign } from "@/lib/campaigns/get-campaign";
import { GroupFiltersSchema } from "@/lib/schemas/group";
import { sendCampaign, type SendCampaignResult } from "./send-campaign";

/** 재발송을 허용하는 원본 캠페인 상태. 완료 건은 중복 발송 방지로 제외. */
const RESENDABLE_STATUSES = new Set(["실패", "취소"]);

export async function resendCampaignSameFilters(
  campaignId: string,
): Promise<SendCampaignResult> {
  if (!campaignId || typeof campaignId !== "string") {
    return { status: "failed", reason: "캠페인 ID 가 유효하지 않습니다" };
  }

  const campaign = await getCampaign(campaignId);
  if (!campaign) {
    return { status: "failed", reason: "존재하지 않는 캠페인입니다" };
  }
  if (!RESENDABLE_STATUSES.has(campaign.status)) {
    return {
      status: "failed",
      reason: `'${campaign.status}' 상태 캠페인은 같은 조건 재발송을 할 수 없습니다 (실패·취소 건만 가능)`,
    };
  }
  if (campaign.is_test) {
    return { status: "failed", reason: "테스트 발송은 재발송할 수 없습니다" };
  }
  if (!campaign.body || !campaign.type) {
    return {
      status: "failed",
      reason: "본문·유형이 저장되지 않은 캠페인이라 재발송할 수 없습니다",
    };
  }

  // 발송 조건 스냅샷 — 없으면(엑셀·설명회 발송, 0121 이전 캠페인) 재현 불가.
  const parsedFilters = GroupFiltersSchema.safeParse(campaign.send_filters);
  if (!parsedFilters.success) {
    return {
      status: "failed",
      reason:
        "발송 조건이 저장되지 않은 캠페인입니다. 문자 발송 화면에서 조건을 직접 골라 보내주세요.",
    };
  }

  return await sendCampaign({
    title: campaign.title,
    filters: parsedFilters.data,
    branch: campaign.branch,
    senderDivision: campaign.sender_division ?? undefined,
    templateId: campaign.template_id,
    body: campaign.body,
    subject: campaign.subject,
    type: campaign.type,
    isAd: campaign.is_ad,
    dedupeByPhone: campaign.dedupe_by_phone,
    sendToParent: campaign.send_to_parent,
    sendToStudent: campaign.send_to_student,
    // 예약이었더라도 재발송은 즉시 발송 — 지난 예약 시각을 되살릴 이유가 없다.
    scheduledAt: null,
    isTest: false,
  });
}
