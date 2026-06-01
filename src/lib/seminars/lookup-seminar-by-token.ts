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
  const supabase = await createSupabaseServerClient();

  // RPC 는 SETOF 반환 — TypeScript 시그니처는 array.
  // Supabase v2 의 RPC 타입 추론이 우리 Database 정의와 잘 안 붙어 좁은 cast 사용.
  const rpcFn = supabase.rpc as unknown as (
    fn: "lookup_seminar_by_token",
    params: { p_token: string },
  ) => Promise<{
    data: LookupSeminarByTokenResult[] | null;
    error: { message: string } | null;
  }>;
  const { data, error } = await rpcFn("lookup_seminar_by_token", {
    p_token: token,
  });

  if (error) {
    throw new Error(`설명회 조회에 실패했습니다: ${error.message}`);
  }
  const row = data && data.length > 0 ? data[0] : null;
  if (!row) return null;
  // PostgreSQL → JSON 직렬화 시 status 는 plain string 이라 타입 좁힘.
  return {
    ...row,
    status: row.status as SeminarStatus,
  };
}
