/**
 * 예약 발송 취소.
 *
 * status='예약됨' 인 캠페인을 발송 전에 사용자가 취소한다(status='취소').
 * 디스패치 워커(dispatch-scheduled)가 이미 '발송중'으로 전이시킨 뒤에는
 * 취소할 수 없다 — 원자적 UPDATE ... WHERE status='예약됨' 으로 경합을 막는다.
 *
 * 안전 가드:
 *   - dev-seed 모드 차단
 *   - 캠페인 존재 + 본 분원 send 권한 확인
 *   - status='예약됨' 일 때만 허용(0행이면 이미 발송 시작 → 실패 반환)
 */

import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/can";
import { getCampaign } from "@/lib/campaigns/get-campaign";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";

export type CancelScheduledResult =
  | { status: "cancelled" }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode"; reason: string };

export async function cancelScheduledCampaign(
  campaignId: string,
): Promise<CancelScheduledResult> {
  if (isDevSeedMode()) {
    return {
      status: "dev_seed_mode",
      reason: "개발 시드 모드에서는 예약 취소가 차단됩니다",
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
    return { status: "failed", reason: "본 분원 캠페인 발송 권한이 없습니다" };
  }

  if (campaign.status !== "예약됨") {
    return {
      status: "failed",
      reason: `예약 상태가 아니라 취소할 수 없습니다 (현재: ${campaign.status})`,
    };
  }

  const supabase = await createSupabaseServerClient();
  // 원자적 취소 — 워커가 이미 '발송중'으로 바꿨으면 0행 → 취소 불가.
  const { data, error } = (await (
    supabase.from("crm_campaigns") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (
          c: string,
          v: string,
        ) => {
          eq: (
            c: string,
            v: string,
          ) => {
            select: (cols: string) => Promise<{
              data: { id: string }[] | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    }
  )
    .update({ status: "취소" })
    .eq("id", campaignId)
    .eq("status", "예약됨")
    .select("id")) as {
    data: { id: string }[] | null;
    error: { message: string } | null;
  };

  if (error) {
    return { status: "failed", reason: `예약 취소에 실패했습니다: ${error.message}` };
  }
  if (!data || data.length === 0) {
    return { status: "failed", reason: "이미 발송이 시작되어 취소할 수 없습니다" };
  }

  return { status: "cancelled" };
}
