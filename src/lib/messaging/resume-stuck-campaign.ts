/**
 * 멈춘 캠페인 수동 재개.
 *
 * 정상 흐름은 `/api/messaging/drain` 자가호출 chain 으로 1,000건 청크씩
 * 자동 발송된다. 하지만 Vercel 함수 인스턴스가 in-flight 자가호출 직전에
 * 정리되면 chain 이 끊겨 campaigns.status='발송중' 인데 messages 중 일부가
 * '대기' 상태로 영원히 남는 경우가 발생한다.
 *
 * 본 함수는 그런 stuck 캠페인을 사용자가 수동으로 재개할 때 호출된다.
 * `/api/messaging/drain` 을 한 번만 트리거하면 거기서부터 자가호출 chain 이
 * 다시 돌며 남은 '대기' 메시지를 모두 발송한다.
 *
 * 안전 가드:
 *   - dev-seed 모드 차단
 *   - 캠페인 존재 + 본 분원 send 권한 확인
 *   - status='발송중' AND 대기 메시지가 1건 이상일 때만 허용
 *   - 동시 재개 차단은 별도 로직 없음 — drain 자체가 1청크에 1,000건만 가져가므로
 *     중복 호출되어도 같은 메시지가 두 번 발송될 위험은 낮다 (drain-campaign.ts
 *     문서 참조). 강한 원자성이 필요하면 advisory lock 으로 보강.
 */

import { waitUntil } from "@vercel/functions";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/can";
import { getCampaign } from "@/lib/campaigns/get-campaign";
import { getCampaignMessageCounts } from "@/lib/campaigns/get-campaign-message-counts";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { getMessagingBaseUrl } from "./base-url";

export type ResumeStuckResult =
  | { status: "kicked"; pendingCount: number }
  | { status: "nothing_to_resume"; reason: string }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode"; reason: string };

export async function resumeStuckCampaign(
  campaignId: string,
): Promise<ResumeStuckResult> {
  if (isDevSeedMode()) {
    return {
      status: "dev_seed_mode",
      reason: "개발 시드 모드에서는 발송 재개가 차단됩니다",
    };
  }

  if (!campaignId || typeof campaignId !== "string") {
    return { status: "failed", reason: "캠페인 ID 가 유효하지 않습니다" };
  }

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

  if (campaign.status !== "발송중") {
    return {
      status: "nothing_to_resume",
      reason: `현재 상태(${campaign.status})에서는 재개할 수 없습니다`,
    };
  }

  const counts = await getCampaignMessageCounts(campaignId);
  if (counts.대기 === 0) {
    return {
      status: "nothing_to_resume",
      reason: "대기 중인 메시지가 없습니다",
    };
  }

  const secret = process.env.DRAIN_SECRET;
  if (!secret) {
    return {
      status: "failed",
      reason: "DRAIN_SECRET 환경변수가 설정되어 있지 않습니다",
    };
  }

  // 드레인 endpoint 1회 트리거 — 거기서부터 자가호출 chain 이 다시 돈다.
  // next/server 의 after() 가 Next 16 + production 조합에서 fire-and-forget
  // 콜백을 발사하지 않는 회귀가 관측되어 @vercel/functions/waitUntil 로 통일.
  // drain route 의 self-invoke 와 동일 API.
  waitUntil(
    fetch(`${getMessagingBaseUrl()}/api/messaging/drain`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-drain-secret": secret,
      },
      body: JSON.stringify({ campaignId }),
      keepalive: true,
    }).catch(() => {
      // 첫 킥 실패는 무시 — 사용자가 버튼을 다시 누르거나 다음 일배치에서 회복.
    }),
  );

  return { status: "kicked", pendingCount: counts.대기 };
}
