import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { EtlSyncRunRow } from "@/types/database";

/**
 * 가장 최근 ETL 동기화 실행 1건을 반환한다 (없으면 null).
 *
 * 사용처: 사이드바 하단 "마지막 동기화" 표시(SidebarSyncStatus).
 * - service 클라이언트 사용 (etl_sync_runs 는 분원 무관 전역 정보).
 * - 부가 정보라 조회 실패해도 앱을 죽이지 않고 null 반환.
 */
export async function getLatestSyncRun(): Promise<EtlSyncRunRow | null> {
  const supabase = createSupabaseServiceClient();

  const { data, error } = await supabase
    .from("etl_sync_runs")
    .select("*")
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[getLatestSyncRun] 조회 실패:", error.message);
    return null;
  }

  return data;
}
