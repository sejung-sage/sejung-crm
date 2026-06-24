/**
 * 캠페인의 sendon 측 실제 발송 결과를 조회해 우리 DB 와 대조한다.
 *
 * 배경: 발송 시점에 sendon 접수(200)를 받으면 우리는 messages 를 '발송됨' 으로 기록하지만,
 * sendon 이 그 후 비동기로 처리 실패(예: 잔액 부족)시킨 건은 추적하지 못한다(도달 확인
 * webhook 미구현). 운영자가 "sendon 에서 실제로 갔는지" 확인할 수 있도록, 캠페인의
 * vendor_message_id(groupId)들을 sendon find API 로 조회해 성공/실패/대기 카운트를 합산한다.
 *
 * 한 캠페인은 batch 1,000건 단위라 여러 groupId 를 가진다. 각 groupId 를 조회해 합친다.
 *
 * 권한은 호출자(Server Action)가 검사한다(master 전용). 조회는 service 클라이언트로
 * messages 를 읽고 sendon 어댑터로 외부 조회만 한다(쓰기 없음).
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getCampaign } from "@/lib/campaigns/get-campaign";
import { createSmsAdapter } from "./adapters";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";

export interface InspectCampaignResult {
  status: "ok" | "failed" | "dev_seed_mode";
  reason?: string;
  /** 캠페인 제목. */
  title?: string;
  /** 우리 DB 의 messages 상태 분포. */
  db?: { 발송됨: number; 대기: number; 실패: number; total: number };
  /** sendon 조회한 groupId 수 / 그중 조회 성공 수. */
  groups?: { total: number; queried: number; failedToQuery: number };
  /** sendon 측 실제 카운트 합계. */
  sendon?: {
    succeeded: number;
    failed: number;
    canceled: number;
    blocked: number;
    sending: number;
    pending: number;
    total: number;
  };
  /** 조회 실패한 groupId 들의 사유(상위 몇 개). */
  queryErrors?: string[];
}

export async function inspectCampaignSendon(
  campaignId: string,
): Promise<InspectCampaignResult> {
  if (isDevSeedMode()) {
    return {
      status: "dev_seed_mode",
      reason: "개발 시드 모드에서는 sendon 조회가 불가합니다",
    };
  }

  const campaign = await getCampaign(campaignId);
  if (!campaign) {
    return { status: "failed", reason: "존재하지 않는 캠페인입니다" };
  }

  const supabase = createSupabaseServiceClient();

  // 1) 우리 DB 의 메시지 상태 분포 + distinct vendor_message_id 수집(페이지네이션).
  const db = { 발송됨: 0, 대기: 0, 실패: 0, total: 0 };
  const groupIds = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("crm_messages")
      .select("status, vendor_message_id")
      .eq("campaign_id", campaignId)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      return { status: "failed", reason: `메시지 조회 실패: ${error.message}` };
    }
    const rows = (data ?? []) as Array<{
      status: string;
      vendor_message_id: string | null;
    }>;
    for (const r of rows) {
      db.total += 1;
      if (r.status === "발송됨") db.발송됨 += 1;
      else if (r.status === "대기") db.대기 += 1;
      else if (r.status === "실패") db.실패 += 1;
      if (r.vendor_message_id) groupIds.add(r.vendor_message_id);
    }
    if (rows.length < PAGE) break;
  }

  // 2) 각 groupId 를 sendon 에 조회해 카운트 합산.
  const adapter = createSmsAdapter();
  const sendon = {
    succeeded: 0,
    failed: 0,
    canceled: 0,
    blocked: 0,
    sending: 0,
    pending: 0,
    total: 0,
  };
  let queried = 0;
  let failedToQuery = 0;
  const queryErrors: string[] = [];
  for (const gid of groupIds) {
    const c = await adapter.queryGroupCounts(gid);
    if (!c.ok) {
      failedToQuery += 1;
      if (c.reason && queryErrors.length < 5) queryErrors.push(c.reason);
      continue;
    }
    queried += 1;
    sendon.succeeded += c.succeeded;
    sendon.failed += c.failed;
    sendon.canceled += c.canceled;
    sendon.blocked += c.blocked;
    sendon.sending += c.sending;
    sendon.pending += c.pending;
    sendon.total += c.total;
  }

  return {
    status: "ok",
    title: campaign.title,
    db,
    groups: { total: groupIds.size, queried, failedToQuery },
    sendon,
    queryErrors: queryErrors.length > 0 ? queryErrors : undefined,
  };
}
