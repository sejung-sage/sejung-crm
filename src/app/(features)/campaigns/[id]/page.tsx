import { notFound } from "next/navigation";
import { getCampaign } from "@/lib/campaigns/get-campaign";
import { listCampaignMessages } from "@/lib/campaigns/list-campaign-messages";
import { CampaignDetailView } from "@/components/campaigns/campaign-detail-view";

/**
 * F3-02 · 캠페인 상세 (/campaigns/[id])
 *
 * Server Component. campaign + messages 를 병렬 로드.
 * Next 16 에서 params 는 Promise — 반드시 await.
 */
export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [campaign, messages] = await Promise.all([
    getCampaign(id),
    listCampaignMessages(id),
  ]);

  if (!campaign) {
    notFound();
  }

  return <CampaignDetailView campaign={campaign} messages={messages} />;
}
