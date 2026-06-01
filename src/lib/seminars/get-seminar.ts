/**
 * 설명회 단건 조회 (운영자) · 0080
 *
 * - dev-seed: `findMockSeminarById` + `listMockSignups` 로 카운트.
 * - 실 DB : crm_seminars.eq(id) + crm_seminar_signups count.
 *
 * 권한: page Server Component 가 master/admin + 분원 격리(can read) 확인.
 *       이 함수는 단순 fetch — RLS 가 2차 방어.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import {
  findMockSeminarById,
  listMockSignups,
  type MockSeminar,
} from "@/lib/seminars/dev-seed";
import type {
  SeminarListItem,
  SeminarRow,
  SeminarStatus,
} from "@/types/database";

/**
 * 설명회 1건 조회. 없으면 null.
 *
 * 반환 타입은 리스트와 동일한 SeminarListItem — 운영자 상세에서도 신청수
 * 함께 표시되어야 자연스럽고, 별도 타입을 두면 호출부가 두 곳에서 분기해야 함.
 */
export async function getSeminar(
  id: string,
): Promise<SeminarListItem | null> {
  if (isDevSeedMode()) {
    return getFromDevSeed(id);
  }
  return getFromSupabase(id);
}

function getFromDevSeed(id: string): SeminarListItem | null {
  const m = findMockSeminarById(id);
  if (!m) return null;
  const signedCount = listMockSignups(id).filter(
    (s) => s.status === "active",
  ).length;
  return mockToSeminarListItem(m, signedCount);
}

function mockToSeminarListItem(
  m: MockSeminar,
  signupCount: number,
): SeminarListItem {
  // 0082: crm_seminars.link_token 폐기 — invitation 단위로 토큰 이동.
  return {
    id: m.id,
    branch: m.branch,
    name: m.name,
    description: m.description,
    held_at: m.starts_at,
    venue: m.venue,
    capacity: m.capacity,
    signup_opens_at: null,
    signup_closes_at: m.application_deadline,
    status: m.status,
    created_by: null,
    created_at: m.created_at,
    updated_at: m.created_at,
    signup_count: signupCount,
  };
}

async function getFromSupabase(id: string): Promise<SeminarListItem | null> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = (await supabase
    .from("crm_seminars")
    .select("*")
    .eq("id", id)
    .maybeSingle()) as unknown as {
    data: SeminarRow | null;
    error: { message: string } | null;
  };
  if (error) {
    throw new Error(`설명회 조회에 실패했습니다: ${error.message}`);
  }
  if (!data) return null;

  // 신청수 — 0082 invitation_items.status='signed' 카운트.
  // (옛 crm_seminar_signups 는 신규 INSERT 없으므로 신뢰할 수 없음.)
  const { count, error: countError } = (await supabase
    .from("crm_seminar_invitation_items")
    .select("id", { count: "exact", head: true })
    .eq("seminar_id", id)
    .eq("status", "signed")) as unknown as {
    count: number | null;
    error: { message: string } | null;
  };
  if (countError) {
    console.warn(`[get-seminar] 신청수 집계 실패: ${countError.message}`);
  }

  return {
    ...data,
    status: data.status as SeminarStatus,
    signup_count: count ?? 0,
  };
}
