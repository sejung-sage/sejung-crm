/**
 * 학부모 학생 페이지 lookup — `/s/<token>` 진입 시 호출 (0082 invitation 모델).
 *
 * 흐름:
 *  - 학부모가 SMS 로 받은 학생 고유 URL `/s/<link_token>` 에 접속.
 *  - 페이지(SSR) 가 이 함수를 호출해 학생 메타 + 카드 N개를 가져온다.
 *  - 카드별 [신청하기] 클릭은 별도 `claimInvitationItemAction`.
 *
 * 권한:
 *  - 인증 불필요. 토큰 보유 = 학부모 본인 가정.
 *  - RPC `lookup_invitation_by_token` (SECURITY DEFINER) 가 RLS 우회.
 *  - 학생 메타(이름·전화)는 학부모 본인 화면 노출 의도 — 마스킹 X.
 *
 * 폴백:
 *  - dev-seed 모드: 가짜 invitation 1개를 합성해 반환 (mock seminar 들로 items 채움).
 *    UI 시연 시 학생 페이지가 빈 카드로 보이지 않도록.
 *  - 실 DB : RPC 에러나 토큰 미존재 → null (page 가 "유효하지 않은 링크" 안내).
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { listMockSeminars } from "@/lib/seminars/dev-seed";
import type {
  InvitationItemStatus,
  LookupInvitationByTokenResult,
  LookupInvitationItem,
} from "@/types/database";

/**
 * 토큰으로 invitation 메타 + 카드 N개를 조회.
 *
 * @param token  URL `/s/<token>` 의 link_token. 빈 문자열은 즉시 null.
 */
export async function lookupInvitationByToken(
  token: string,
): Promise<LookupInvitationByTokenResult | null> {
  if (!token || token.trim().length === 0) return null;

  if (isDevSeedMode()) {
    return lookupFromDevSeed(token);
  }
  return lookupFromSupabase(token);
}

// ─── dev-seed ─────────────────────────────────────────────────

/**
 * dev-seed 합성 invitation.
 *
 * 운영자 시연 시 `/s/<아무 토큰>` 으로 들어와도 학생 페이지가 빈 화면이 아니라
 * "홍길동 / 010-1234-5678 / 카드 3개" 가 보이도록 가짜 결과를 만든다.
 *
 * - 토큰이 mock SEMINARS 의 옛 토큰(`tok_*`) 과 일치하면 그 설명회 1개만 카드로.
 * - 그 외 토큰은 active 한 상위 3개 mock 설명회를 카드로 보여준다.
 */
function lookupFromDevSeed(
  token: string,
): LookupInvitationByTokenResult | null {
  // mock 의 모든 설명회 (필터 없음).
  const all = listMockSeminars();
  // 옛 토큰 매칭 시 그 설명회만, 아니면 open + closed 상위 3건.
  const seminarsForToken =
    all.find((s) => s.token === token) === undefined
      ? all
          .filter((s) => s.status === "open" || s.status === "closed")
          .slice(0, 3)
      : all.filter((s) => s.token === token);

  if (seminarsForToken.length === 0) return null;

  const items: LookupInvitationItem[] = seminarsForToken.map((s, idx) => ({
    item_id: `dev-item-${s.id}`,
    seminar_id: s.id,
    name: s.name,
    description: s.description,
    held_at: s.starts_at,
    venue: s.venue,
    // 첫 카드만 'signed' 로 두어 멱등 케이스도 화면 확인 가능.
    status: (idx === 0 ? "signed" : "pending") as InvitationItemStatus,
    signed_at: idx === 0 ? new Date().toISOString() : null,
  }));

  return {
    invitation_id: `dev-inv-${token}`,
    student_id: "dev-student-001",
    student_name: "홍길동",
    parent_phone: "01012345678",
    branch: seminarsForToken[0].branch,
    items,
  };
}

// ─── Supabase ────────────────────────────────────────────────

async function lookupFromSupabase(
  token: string,
): Promise<LookupInvitationByTokenResult | null> {
  // 학부모 공개 페이지에서 호출되므로 RPC 에러를 학부모 화면에 노출하지 않는다.
  // page 가 null 을 "유효하지 않은 링크" 로 안내.
  try {
    const supabase = await createSupabaseServerClient();

    // ⚠️ `.bind(supabase)` 필수 — `supabase.rpc` 를 변수에 담아 호출하면
    // `this` 바인딩이 깨져 클라이언트 내부 `this.rest` 가 undefined 가 되어 TypeError.
    const rpcFn = supabase.rpc.bind(supabase) as unknown as (
      fn: "lookup_invitation_by_token",
      params: { p_token: string },
    ) => Promise<{
      data: LookupInvitationByTokenResult[] | null;
      error: { message: string; code?: string; details?: string } | null;
    }>;

    const { data, error } = await rpcFn("lookup_invitation_by_token", {
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
