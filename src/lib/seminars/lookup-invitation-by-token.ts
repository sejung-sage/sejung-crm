/**
 * 학부모 학생 페이지 lookup — `/s/<token>` 진입 시 호출 (0085 새 RPC).
 *
 * 흐름:
 *  - 학부모가 SMS 로 받은 학생 고유 URL `/s/<link_token>` 에 접속.
 *  - 페이지(SSR) 가 이 함수를 호출해 학생 메타 + 카드 N개를 가져온다.
 *  - 카드별 [신청하기] 클릭은 별도 `claimInvitationItemAction` (0085 claim_signup_item RPC).
 *
 * 권한:
 *  - 인증 불필요. 토큰 보유 = 학부모 본인 가정.
 *  - RPC `lookup_signup_invitation_by_token` (SECURITY DEFINER) 가 RLS 우회.
 *  - 학생 메타(이름·전화)는 학부모 본인 화면 노출 의도 — 마스킹 X.
 *
 * dev-seed 폴백은 Phase 2-B-3 (2026-06-02) 에서 제거 — 시연 데이터가 새 모델로
 * 옮겨오지 않았고, 실 DB 가 없으면 학부모 페이지가 "유효하지 않은 링크" 로
 * graceful 처리되면 충분하다.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { LookupInvitationByTokenResult } from "@/types/database";

/**
 * 토큰으로 invitation 메타 + 카드 N개를 조회.
 *
 * @param token  URL `/s/<token>` 의 link_token. 빈 문자열은 즉시 null.
 */
export async function lookupInvitationByToken(
  token: string,
): Promise<LookupInvitationByTokenResult | null> {
  if (!token || token.trim().length === 0) return null;

  // 학부모 공개 페이지에서 호출되므로 RPC 에러를 학부모 화면에 노출하지 않는다.
  // page 가 null 을 "유효하지 않은 링크" 로 안내.
  try {
    const supabase = await createSupabaseServerClient();

    // ⚠️ `.bind(supabase)` 필수 — `supabase.rpc` 를 변수에 담아 호출하면
    // `this` 바인딩이 깨져 클라이언트 내부 `this.rest` 가 undefined 가 되어 TypeError.
    const rpcFn = supabase.rpc.bind(supabase) as unknown as (
      fn: "lookup_signup_invitation_by_token",
      params: { p_token: string },
    ) => Promise<{
      data: LookupInvitationByTokenResult[] | null;
      error: { message: string; code?: string; details?: string } | null;
    }>;

    const { data, error } = await rpcFn("lookup_signup_invitation_by_token", {
      p_token: token,
    });

    if (error) {
      console.error(
        `[lookup-invitation-by-token] RPC 실패 token=${token.slice(0, 4)}... code=${error.code ?? "?"} msg=${error.message} details=${error.details ?? "-"}`,
      );
      return null;
    }
    const row = data && data.length > 0 ? data[0] : null;
    if (!row) return null;

    // items 는 RPC 가 jsonb 로 반환 — PostgREST 가 JSON 파싱해 객체 배열로 줌.
    // 안전을 위해 결측 시 빈 배열로 정규화.
    return {
      ...row,
      items: Array.isArray(row.items) ? row.items : [],
    };
  } catch (e) {
    console.error(
      `[lookup-invitation-by-token] 예기치 못한 예외 token=${token.slice(0, 4)}...`,
      e,
    );
    return null;
  }
}
