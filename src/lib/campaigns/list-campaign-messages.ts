/**
 * F3-A · 캠페인 건별 메시지 리스트
 *
 * - dev-seed: listDevCampaignMessages (학생명 조인 포함)
 * - Supabase: messages + students(name) PostgREST 임베드
 *
 * 학생명 표시:
 *   PostgREST 의 `students:student_id(name)` 임베드로 students.name 을 한 번에
 *   조인. 응답은 `{ ..., students: { name } }` 형태로 오므로 flatten 해서
 *   CampaignMessageRow.student_name 에 매핑. 테스트 발송(student_id=NULL) 또는
 *   학생 삭제된 행은 student_name = null → UI 가 "(학생 정보 없음)" 으로 표시.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { CampaignMessageRow } from "@/types/database";
import {
  isDevSeedMode,
  listDevCampaignMessages,
} from "@/lib/profile/students-dev-seed";

/** PostgREST 임베드 응답 — students 가 단일 객체 또는 배열로 올 수 있음. */
type RawJoined = Omit<CampaignMessageRow, "student_name"> & {
  students: { name: string } | { name: string }[] | null;
};

export async function listCampaignMessages(
  campaignId: string,
): Promise<CampaignMessageRow[]> {
  if (!campaignId) return [];

  if (isDevSeedMode()) {
    return listDevCampaignMessages(campaignId);
  }

  const supabase = await createSupabaseServerClient();
  // 60K+ 캠페인 상세 페이지 로드 시 statement timeout 회피:
  //  - .limit(50) 으로 첫 페이지만 받음 (이전 무제한 → 60K 전체 sort 로 8초 timeout)
  //  - 정렬: 최신 발송시각 우선 (created_at DESC) — 0033 인덱스 활용.
  //    PostgreSQL 기본 인덱스 정렬이 ASC 라 (campaign_id, created_at DESC) 가
  //    DESC 방향 정렬을 인덱스만으로 처리 → ms 단위 응답.
  //  - UI 의 CampaignMessagesTable 은 클라이언트 페이지네이션 (50건 안에서만 동작).
  //    50건 이상 페이지 이동은 추후 server-side paginate (page param) 으로 확장.
  const { data, error } = await supabase
    .from("crm_messages")
    .select("*, students:student_id(name)")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new Error(`캠페인 메시지 조회에 실패했습니다: ${error.message}`);
  }

  return (data ?? []).map((raw) => {
    const r = raw as RawJoined;
    const studentName = extractStudentName(r.students);
    const { students: _drop, ...rest } = r;
    void _drop;
    return { ...rest, student_name: studentName } as CampaignMessageRow;
  });
}

function extractStudentName(
  students: RawJoined["students"],
): string | null {
  if (!students) return null;
  if (Array.isArray(students)) {
    return students[0]?.name ?? null;
  }
  return students.name ?? null;
}
