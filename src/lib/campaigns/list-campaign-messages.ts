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

// 상세 페이지에 한 번에 로드할 건별 메시지 상한.
// 단일 캠페인 실수신자는 분원 전체(수천 명) 규모라 이 값이면 실무상 전부 표시.
// 인덱스(LIMIT) 로 끊으므로 6만 건 캠페인이어도 timeout 없이 안전.
const MAX_ROWS = 5000;

export async function listCampaignMessages(
  campaignId: string,
): Promise<CampaignMessageRow[]> {
  if (!campaignId) return [];

  if (isDevSeedMode()) {
    return listDevCampaignMessages(campaignId);
  }

  const supabase = await createSupabaseServerClient();
  // 60K+ 캠페인 상세 페이지 로드 시 statement timeout 회피:
  //  - .limit(MAX_ROWS) 로 상한을 둠 (이전 무제한 → 60K 전체 sort 로 8초 timeout).
  //  - 정렬: 최신 발송시각 우선 (created_at DESC) — 0033 인덱스 활용.
  //    (campaign_id, created_at DESC) 인덱스를 LIMIT 와 함께 쓰면 전체 sort 없이
  //    앞에서부터 LIMIT 만큼만 읽고 멈춤 → ms 단위 응답.
  //  - 칩 카운트는 별도 head 쿼리(getCampaignMessageCounts)라 MAX_ROWS 로 잘려도
  //    전체 건수는 정확히 유지된다.
  //  - UI 의 CampaignMessagesTable 은 로드된 rows 안에서 클라이언트 페이지네이션.
  const { data, error } = await supabase
    .from("crm_messages")
    .select("*, students:student_id(name)")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);

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
