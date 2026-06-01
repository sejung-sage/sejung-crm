/**
 * 설명회 신청자 명단 조회 (운영자) · 0080
 *
 * 단순 fetch — 정렬은 신청 시각 역순(최신 위). 검색/페이지네이션은 페이지·테이블
 * 단(UI in-memory) 에서 처리. 운영자 페이지 한 곳에서만 부르는 가벼운 로더.
 *
 * - dev-seed: `listMockSignups(seminar_id)` 어댑팅.
 * - 실 DB : crm_seminar_signups + seminar_id eq + status desc(signed → cancelled).
 *
 * 학부모 전화 마스킹은 호출부(권한별)에서 결정 — 로더는 raw 반환.
 *
 * 권한 가드는 호출부 page 가 처리. 본 로더는 단순 fetch.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import {
  listMockSignups,
  type MockSignup,
} from "@/lib/seminars/dev-seed";
import type {
  SeminarSignupRow,
  SignupStatus,
} from "@/types/database";

/**
 * 특정 설명회의 신청자 명단을 모두 반환.
 *
 * 정렬: created_at DESC (최신 신청이 위).
 * cancelled 도 포함. UI 에서 토글하거나 회색 처리.
 *
 * Phase 1 규모(설명회당 수십~수백 명) 가정. 페이지네이션 없음.
 */
export async function listSignups(
  seminarId: string,
): Promise<SeminarSignupRow[]> {
  if (typeof seminarId !== "string" || seminarId.length === 0) {
    return [];
  }
  if (isDevSeedMode()) {
    return listFromDevSeed(seminarId);
  }
  return listFromSupabase(seminarId);
}

// ─── dev-seed ─────────────────────────────────────────────────

function listFromDevSeed(seminarId: string): SeminarSignupRow[] {
  return listMockSignups(seminarId).map(mockToSignupRow);
}

function mockToSignupRow(m: MockSignup): SeminarSignupRow {
  // mock 의 status enum 은 active/cancelled, DB enum 은 signed/cancelled.
  const status: SignupStatus = m.status === "active" ? "signed" : "cancelled";
  return {
    id: m.id,
    seminar_id: m.seminar_id,
    student_name: m.student_name,
    // mock 은 표시용 하이픈 포함 — DB 컬럼 정책(숫자만) 과 다르나 호출부는
    // 마스킹·표시 시 어차피 digits 만 본다. raw 반환 유지.
    parent_phone: m.parent_phone,
    status,
    client_ip: null,
    user_agent: null,
    created_at: m.signed_up_at,
    cancelled_at: status === "cancelled" ? m.signed_up_at : null,
    cancelled_by: null,
  };
}

// ─── Supabase ─────────────────────────────────────────────────

async function listFromSupabase(
  seminarId: string,
): Promise<SeminarSignupRow[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = (await supabase
    .from("crm_seminar_signups")
    .select("*")
    .eq("seminar_id", seminarId)
    .order("created_at", { ascending: false })) as unknown as {
    data: SeminarSignupRow[] | null;
    error: { message: string } | null;
  };

  if (error) {
    throw new Error(`신청자 명단 조회에 실패했습니다: ${error.message}`);
  }

  return data ?? [];
}
