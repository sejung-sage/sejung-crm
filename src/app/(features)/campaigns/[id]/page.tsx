import { notFound } from "next/navigation";
import { getCampaign } from "@/lib/campaigns/get-campaign";
import { listCampaignMessages } from "@/lib/campaigns/list-campaign-messages";
import { getCampaignMessageCounts } from "@/lib/campaigns/get-campaign-message-counts";
import { CampaignDetailView } from "@/components/campaigns/campaign-detail-view";

/**
 * F3-02 · 캠페인 상세 (/campaigns/[id])
 *
 * Server Component. campaign + messages + 진행률 카운트를 병렬 로드.
 * 진행률 카운트는 head 쿼리라 60K 캠페인이어도 가볍게 산출.
 * Next 16 에서 params 는 Promise — 반드시 await.
 */
export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [campaign, messages, counts] = await Promise.all([
    getCampaign(id),
    listCampaignMessages(id),
    getCampaignMessageCounts(id),
  ]);

  if (!campaign) {
    notFound();
  }

  return (
    <CampaignDetailView
      campaign={campaign}
      messages={messages}
      counts={counts}
    />
  );
}
