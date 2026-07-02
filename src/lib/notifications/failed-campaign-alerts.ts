/**
 * 발송 실패 앱 내 알림 · 데이터 레이어
 *
 * 모든 발송 실패 경로(동기·드레인·예약·크론)가 crm_campaigns.status='실패' 로
 * 수렴하므로, 이 행을 읽으면 백그라운드 실패까지 한 곳에서 커버된다.
 *
 * 확인(dismiss) 상태는 crm_campaigns.failure_acknowledged_at (0105) 로 관리:
 *   NULL   = 미확인 → 배너 노출
 *   값 있음 = 확인됨 → 배너에서 제외
 *
 * 읽기(getFailedCampaignAlerts):
 *   - 세션 클라이언트 → RLS(0075)로 본인(created_by) 발송분 or 마스터=전체 자동 스코프.
 * 확인(acknowledgeFailedCampaigns):
 *   - 세션 RLS 에 crm_campaigns UPDATE 정책이 없을 수 있어(취소도 서비스 클라이언트
 *     사용) 서비스 클라이언트로 UPDATE. 대신 role != master 는 created_by 스코프
 *     가드로 남의 실패건을 확인하지 못하도록 앱 단에서 강제한다.
 *
 * failure_acknowledged_at 은 gen types 에 아직 없을 수 있어, 취소 로직과 동일한
 * 좁은 캐스트 관례(chainable 인터페이스)로 접근한다. any 는 사용하지 않는다.
 */

import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import type { CurrentUser } from "@/types/database";

export type FailedCampaignAlert = {
  id: string;
  title: string;
  branch: string;
  createdAt: string;
  totalRecipients: number;
};

/** 미확인 실패 캠페인 조회 상한 — 배너는 최근 소수만 보여주면 충분. */
const ALERT_LIMIT = 20;

interface AlertRow {
  id: string;
  title: string;
  branch: string;
  created_at: string;
  total_recipients: number | null;
}

/**
 * 미확인 발송 실패 캠페인 목록.
 * status='실패' AND failure_acknowledged_at IS NULL AND is_test=false,
 * created_at DESC, limit 20. RLS 로 본인/마스터 스코프가 자동 적용된다.
 * 세션이 없으면(미로그인) RLS 가 0행을 반환하므로 자연히 빈 배열이 된다.
 */
export async function getFailedCampaignAlerts(): Promise<FailedCampaignAlert[]> {
  const supabase = await createSupabaseServerClient();

  type AlertQuery = {
    eq(col: string, val: string | boolean): AlertQuery;
    is(col: string, val: null): AlertQuery;
    order(col: string, opts: { ascending: boolean }): AlertQuery;
    limit(n: number): Promise<{
      data: AlertRow[] | null;
      error: { message: string } | null;
    }>;
  };

  const { data, error } = await (
    supabase.from("crm_campaigns") as unknown as {
      select(cols: string): AlertQuery;
    }
  )
    .select("id, title, branch, created_at, total_recipients")
    .eq("status", "실패")
    .is("failure_acknowledged_at", null)
    .eq("is_test", false)
    .order("created_at", { ascending: false })
    .limit(ALERT_LIMIT);

  if (error) {
    throw new Error(`발송 실패 알림 조회에 실패했습니다: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    branch: row.branch,
    createdAt: row.created_at,
    totalRecipients: row.total_recipients ?? 0,
  }));
}

/**
 * 실패 캠페인 확인 처리 — failure_acknowledged_at 을 현재 시각으로 채운다.
 *
 * @param campaignIds 특정 캠페인만 확인하려면 id 배열, 미확인 전체는 "all".
 * @param viewer 스코프 가드용. null 이면 아무것도 처리하지 않는다.
 * @returns 실제로 갱신된 행 수.
 */
export async function acknowledgeFailedCampaigns(
  campaignIds: string[] | "all",
  viewer: Pick<CurrentUser, "role" | "user_id"> | null,
): Promise<{ acknowledged: number }> {
  if (!viewer) {
    return { acknowledged: 0 };
  }

  // 배열인데 비어 있으면 대상이 없으므로 즉시 종료.
  if (Array.isArray(campaignIds) && campaignIds.length === 0) {
    return { acknowledged: 0 };
  }

  const supabase = createSupabaseServiceClient();

  type UpdateFilter = {
    eq(col: string, val: string | boolean): UpdateFilter;
    is(col: string, val: null): UpdateFilter;
    in(col: string, vals: string[]): UpdateFilter;
    select(cols: string): Promise<{
      data: { id: string }[] | null;
      error: { message: string } | null;
    }>;
  };

  let query = (
    supabase.from("crm_campaigns") as unknown as {
      update(v: Record<string, unknown>): UpdateFilter;
    }
  )
    .update({ failure_acknowledged_at: new Date().toISOString() })
    .eq("status", "실패")
    .is("failure_acknowledged_at", null)
    .eq("is_test", false);

  if (Array.isArray(campaignIds)) {
    query = query.in("id", campaignIds);
  }

  // 스코프 가드: 마스터가 아니면 본인 발송분만 확인 가능.
  if (viewer.role !== "master") {
    query = query.eq("created_by", viewer.user_id);
  }

  const { data, error } = await query.select("id");

  if (error) {
    throw new Error(`발송 실패 알림 확인에 실패했습니다: ${error.message}`);
  }

  return { acknowledged: (data ?? []).length };
}
