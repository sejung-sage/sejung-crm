/**
 * 발송 내역(캠페인) 삭제 — master 전용.
 *
 * 발송 기록은 회계 감사를 위해 기본 보존하지만(목록 상단 안내), 잘못 보낸 테스트
 * 발송 등을 정리할 수 있도록 master 계정에 한해 삭제를 허용한다(운영 요청 2026-06-23).
 *
 * 삭제 범위:
 *   - crm_campaigns 행 + crm_messages(campaign_id FK ON DELETE CASCADE)가 함께 삭제됨.
 *   - 설명회 invitation(crm_class_signup_invitations.campaign_id)은 FK 가 없어 영향 없음
 *     (학생 신청 데이터는 보존). campaign_id 만 가리키지 않게 남는다(무해).
 *
 * 안전 가드:
 *   - dev-seed 모드 차단.
 *   - role='master' 만 허용(admin/manager 불가 — 회계 보존 정책).
 *   - 존재하지 않는 캠페인이면 실패.
 *
 * 권한을 액션이 검사하므로 삭제는 service 클라이언트로 수행(RLS 우회).
 */

import { getCurrentUser } from "@/lib/auth/current-user";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getCampaign } from "@/lib/campaigns/get-campaign";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";

export type DeleteCampaignResult =
  | { status: "deleted" }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode"; reason: string };

export async function deleteCampaign(
  campaignId: string,
): Promise<DeleteCampaignResult> {
  if (isDevSeedMode()) {
    return {
      status: "dev_seed_mode",
      reason: "개발 시드 모드에서는 발송 내역 삭제가 차단됩니다",
    };
  }

  if (!campaignId || typeof campaignId !== "string") {
    return { status: "failed", reason: "캠페인 ID 가 유효하지 않습니다" };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { status: "failed", reason: "로그인 후 이용 가능합니다" };
  }
  if (user.role !== "master") {
    return {
      status: "failed",
      reason: "발송 내역 삭제는 마스터 계정만 가능합니다",
    };
  }

  const campaign = await getCampaign(campaignId);
  if (!campaign) {
    return { status: "failed", reason: "존재하지 않는 캠페인입니다" };
  }

  const supabase = createSupabaseServiceClient();

  type Deletable = {
    delete: () => {
      eq: (
        c: string,
        v: string,
      ) => Promise<{ error: { message: string } | null }>;
    };
  };

  // 1) 메시지 먼저 삭제 — crm_messages.campaign_id FK 가 ON DELETE CASCADE 이지만,
  //    prefix rename 이력상 보장을 확신할 수 없어 명시적으로 먼저 지운다(idempotent).
  const msgRes = await (supabase.from("crm_messages") as unknown as Deletable)
    .delete()
    .eq("campaign_id", campaignId);
  if (msgRes.error) {
    return { status: "failed", reason: `메시지 삭제 실패: ${msgRes.error.message}` };
  }

  // 2) 캠페인 삭제.
  const { error } = await (
    supabase.from("crm_campaigns") as unknown as Deletable
  )
    .delete()
    .eq("id", campaignId);

  if (error) {
    return { status: "failed", reason: `삭제 실패: ${error.message}` };
  }
  return { status: "deleted" };
}
