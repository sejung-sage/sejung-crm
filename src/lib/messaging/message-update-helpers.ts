/**
 * F3 Part B · 발송 결과 반영 공용 헬퍼.
 *
 * 실패 일괄 재발송(`resend-failed`) · 단건 재발송(`resend-single`) 등 여러 재발송
 * 경로가 공유하는 file-private 헬퍼들을 한 곳으로 모았다. 동작은 종전 resend-failed
 * 의 file-private 버전과 동일하다(추출만, 로직 불변).
 *
 *   - readFromNumber          : 어댑터별 발신번호를 환경변수에서만 읽음(하드코딩 금지).
 *   - extractFailedReason     : 벤더 응답/예외에서 실패 사유 문자열 추출.
 *   - updateMessage           : crm_messages 단건 patch (좁은 cast).
 *   - safeUpdateCampaignStatus: crm_campaigns.status 갱신.
 *   - incrementCampaignCost   : crm_campaigns.total_cost 누적 갱신.
 *
 * 비용 정책: messages.cost / campaigns.total_cost 는 INT 컬럼이므로 저장 직전
 * Math.round. 단가는 소수(SMS 7.4원 등)라서 누적은 호출부가 float 으로 보존하고,
 * 저장 시점에만 반올림한다.
 */

import type { SmsSendResult } from "./adapters/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sendonFromNumber } from "@/config/sender-numbers";

type SupabaseSrv = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** 캠페인 상태 enum. crm_campaigns.status 가 허용하는 값. */
export type CampaignStatus =
  | "발송중"
  | "완료"
  | "실패"
  | "예약됨"
  | "취소"
  | "임시저장";

/**
 * 어댑터별 발신번호를 환경변수에서만 읽는다. 하드코딩 금지(CLAUDE.md 가드).
 * sendon 은 분원별 번호가 달라 branch 를 받아 분원 전용 번호를 해석한다(미설정 시
 * SENDON_FROM_NUMBER 폴백). 알 수 없는 어댑터면 null → 호출부가 발송을 거부한다.
 */
export function readFromNumber(
  adapterName: string,
  branch?: string | null,
): string | null {
  switch (adapterName) {
    case "sendon":
      return sendonFromNumber(branch);
    default:
      return null;
  }
}

/**
 * 벤더 응답/예외에서 실패 사유 문자열을 뽑는다. 벤더 메시지를 그대로
 * messages.failed_reason 에 기록하기 위함(관찰성).
 */
export function extractFailedReason(
  sr: PromiseSettledResult<SmsSendResult> | undefined,
): string {
  if (!sr) return "발송 결과를 읽지 못했습니다";
  if (sr.status === "rejected") {
    const e = sr.reason;
    if (e instanceof Error) return e.message;
    return "벤더 응답 오류";
  }
  if (sr.value.status === "failed") {
    return sr.value.reason;
  }
  return "벤더 응답이 비정상입니다";
}

/** crm_messages 단건 patch. 좁은 cast(groups/templates actions 패턴). */
export async function updateMessage(
  supabase: SupabaseSrv,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await (
    supabase.from("crm_messages") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (
          col: string,
          val: string,
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )
    .update(patch)
    .eq("id", id);
}

/** crm_campaigns.status 갱신. */
export async function safeUpdateCampaignStatus(
  supabase: SupabaseSrv,
  campaignId: string,
  status: CampaignStatus,
): Promise<void> {
  await (
    supabase.from("crm_campaigns") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (
          col: string,
          val: string,
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )
    .update({ status })
    .eq("id", campaignId);
}

/**
 * crm_campaigns.total_cost 누적 갱신.
 * 현재값 + added 로 단순 갱신(race 가능성은 매우 낮은 워크플로우).
 * 강한 원자성 필요시 RPC SQL 함수로 옮길 수 있음(Phase 1).
 */
export async function incrementCampaignCost(
  supabase: SupabaseSrv,
  campaignId: string,
  added: number,
): Promise<void> {
  if (added <= 0) return;

  const { data: cur } = await supabase
    .from("crm_campaigns")
    .select("total_cost")
    .eq("id", campaignId)
    .maybeSingle();

  const curRow = cur as unknown as { total_cost?: number } | null;
  const currentCost =
    typeof curRow?.total_cost === "number" ? curRow.total_cost : 0;

  await (
    supabase.from("crm_campaigns") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (
          col: string,
          val: string,
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )
    .update({ total_cost: Math.round(currentCost + added) })
    .eq("id", campaignId);
}
