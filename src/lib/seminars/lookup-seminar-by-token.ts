/**
 * 학부모 공개 페이지(`/s/<token>`) 진입 시 호출하는 메타 lookup.
 *
 * - dev-seed: `findMockSeminarByToken` 어댑팅 (capacity / signup_opens_at 등 제외).
 * - 실 DB : `lookup_seminar_by_token` RPC 호출 (SECURITY DEFINER, anon 허용).
 *
 * 권한:
 *  - 인증 불필요. 토큰만 알면 누구나 조회 가능.
 *  - capacity 와 신청 수는 반환에서 의도적으로 제외 (학부모 비공개).
 *
 * 반환:
 *  - 해당 토큰의 설명회 1행 또는 null. 호출부(page) 가 404 결정.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import {
  findMockSeminarByToken,
  type MockSeminar,
} from "@/lib/seminars/dev-seed";
import type {
  LookupSeminarByTokenResult,
  SeminarStatus,
} from "@/types/database";

/**
 * 학부모 공개 메타 조회.
 *
 * @param token  URL `/s/<token>` 의 link_token. 빈 문자열은 즉시 null.
 */
export async function lookupSeminarByToken(
  token: string,
): Promise<LookupSeminarByTokenResult | null> {
  if (!token || token.trim().length === 0) return null;

  if (isDevSeedMode()) {
    return lookupFromDevSeed(token);
  }
  return lookupFromSupabase(token);
}

function lookupFromDevSeed(
  token: string,
): LookupSeminarByTokenResult | null {
  const m = findMockSeminarByToken(token);
  if (!m) return null;
  return mockToPublicResult(m);
}

function mockToPublicResult(m: MockSeminar): LookupSeminarByTokenResult {
  return {
    id: m.id,
    name: m.name,
    description: m.description,
    held_at: m.starts_at,
    venue: m.venue,
    status: m.status,
    signup_opens_at: null,
    signup_closes_at: m.application_deadline,
    branch: m.branch,
  };
}

async function lookupFromSupabase(
  token: string,
): Promise<LookupSeminarByTokenResult | null> {
  // 학부모 공개 페이지에서 호출되므로 RPC 에러가 그대로 throw 되면 error.tsx
  // (generic "일시적인 오류") 가 잡아 학부모에게 불친절한 화면이 노출된다.
  // 호출부(page) 는 null 을 "유효하지 않은 링크" 로 안내하므로, 여기서는
  // 에러를 console.error 로 Vercel 함수 로그에만 남기고 null 을 반환한다.
  try {
    const supabase = await createSupabaseServerClient();

    // RPC 는 SETOF 반환 — TypeScript 시그니처는 array.
    // Supabase v2 의 RPC 타입 추론이 우리 Database 정의와 잘 안 붙어 좁은 cast 사용.
    // ⚠️ `.bind(supabase)` 필수 — `supabase.rpc` 를 그냥 변수에 담아 호출하면
    // `this` 바인딩이 깨져 클라이언트 내부 `this.rest` 접근 시 TypeError.
    // (dev 서버에선 우연히 동작하나 Next prod SSR 번들에선 즉시 터진다.)
    const rpcFn = supabase.rpc.bind(supabase) as unknown as (
      fn: "lookup_seminar_by_token",
      params: { p_token: string },
    ) => Promise<{
      data: LookupSeminarByTokenResult[] | null;
      error: { message: string; code?: string; details?: string } | null;
    }>;
    const { data, error } = await rpcFn("lookup_seminar_by_token", {
      p_token: token,
    });

    if (error) {
      console.error(
        `[lookup-seminar-by-token] RPC 실패 token=${token.slice(0, 4)}... code=${error.code ?? "?"} msg=${error.message} details=${error.details ?? "-"}`,
      );
      return null;
    }
    const row = data && data.length > 0 ? data[0] : null;
    if (!row) return null;
    // PostgreSQL → JSON 직렬화 시 status 는 plain string 이라 타입 좁힘.
    return {
      ...row,
      status: row.status as SeminarStatus,
    };
  } catch (e) {
    // env 누락 / 네트워크 / cookies() 실패 등 예기치 못한 예외도 학부모에게는
    // "유효하지 않은 링크" 로 graceful 안내. 실제 원인은 Vercel 함수 로그에서 추적.
    console.error(
      `[lookup-seminar-by-token] 예기치 못한 예외 token=${token.slice(0, 4)}...`,
      e,
    );
    return null;
  }
}
