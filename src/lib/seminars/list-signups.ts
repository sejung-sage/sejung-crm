/**
 * 설명회 신청자 명단 (운영자) — 0082 invitation 모델로 재작성.
 *
 * 이전 (0080) 까지는 학부모가 폼 입력으로 `crm_seminar_signups` 에 row 를 만들었다.
 * 0082 부터는 운영자가 (설명회 N × 학생 M) invitation 매트릭스를 발송하고,
 * 학부모가 학생 페이지에서 카드별 [신청하기] 를 누르면 `crm_seminar_invitation_items.status`
 * 가 `'signed'` 로 전이된다. 따라서 신청 명단 = 그 설명회로 보낸 invitation_items
 * 중 status='signed' 인 행들.
 *
 * 반환 모양 (운영 명단 UI 가 직접 사용):
 *   - item_id        : crm_seminar_invitation_items.id (카드 PK — 취소 액션 입력)
 *   - invitation_id  : crm_seminar_invitations.id (학생 페이지 PK)
 *   - student_id     : crm_students.id
 *   - student_name   : 학생 이름
 *   - parent_phone   : 학부모 전화 (raw, 호출부에서 권한별 마스킹)
 *   - status         : 'signed' (기본) — 미래에 'cancelled' 까지 확장 가능
 *   - signed_at      : 신청 시각 (UTC)
 *
 * 정렬: signed_at DESC (최신 신청 위).
 *
 * 권한 가드는 호출부(page) 가 처리. 본 로더는 단순 fetch + RLS 의존.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { listMockSignups } from "@/lib/seminars/dev-seed";
import type { InvitationItemStatus } from "@/types/database";

/**
 * 설명회 신청자 명단 1행 — invitation_items 기반.
 *
 * frontend SignupsTable / 운영 명단 화면 이 직접 소비. raw parent_phone 그대로
 * 반환하므로 호출부에서 권한별 마스킹(`maskPhone`)을 결정한다.
 */
export interface InvitationSignupRow {
  item_id: string;
  invitation_id: string;
  student_id: string;
  student_name: string;
  /** 숫자만 정규화 저장된 학부모 전화. dev-seed 어댑터는 표시용 하이픈 포함 가능. */
  parent_phone: string;
  /** 현재는 'signed' 중심이지만 'cancelled' 포함 케이스도 처리할 수 있도록 enum 유지. */
  status: InvitationItemStatus;
  /** 학부모가 [신청하기] 누른 시각 (UTC ISO). status='signed' 이면 NOT NULL. */
  signed_at: string | null;
}

/**
 * 특정 설명회의 신청자 명단을 반환.
 *
 * - status='signed' 행만. 정렬은 signed_at DESC (최신이 위).
 * - 페이지네이션 없음 (Phase 1 가정: 설명회당 수십~수백 명).
 */
export async function listSignups(
  seminarId: string,
): Promise<InvitationSignupRow[]> {
  if (typeof seminarId !== "string" || seminarId.length === 0) {
    return [];
  }
  if (isDevSeedMode()) {
    return listFromDevSeed(seminarId);
  }
  return listFromSupabase(seminarId);
}

// ─── dev-seed ─────────────────────────────────────────────────

/**
 * mock 데이터 어댑팅 — 옛 폼 signup 을 invitation_items shape 로 합성.
 * 운영 시연에 충분한 모양만 갖춰주고 식별자는 mock 고유 ID 그대로 사용.
 */
function listFromDevSeed(seminarId: string): InvitationSignupRow[] {
  return listMockSignups(seminarId)
    .filter((m) => m.status === "active")
    .map<InvitationSignupRow>((m) => ({
      item_id: `dev-item-${m.id}`,
      invitation_id: `dev-inv-${m.id}`,
      student_id: `dev-student-${m.id}`,
      student_name: m.student_name,
      parent_phone: m.parent_phone,
      status: "signed",
      signed_at: m.signed_up_at,
    }));
}

// ─── Supabase ────────────────────────────────────────────────

/**
 * 실 DB 조회.
 *
 * invitation_items.status='signed' AND seminar_id=? 인 행을
 * invitations JOIN crm_students 와 함께 SELECT.
 *
 * PostgREST nested select 문법:
 *   `invitation:crm_seminar_invitations!inner(id, student:crm_students!inner(id,name,parent_phone))`
 *
 * RLS 가 분원 격리를 적용 — service-role 우회 없이 일반 user 클라이언트로 호출.
 */
async function listFromSupabase(
  seminarId: string,
): Promise<InvitationSignupRow[]> {
  const supabase = await createSupabaseServerClient();

  type Row = {
    id: string;
    signed_at: string | null;
    status: InvitationItemStatus;
    invitation_id: string;
    invitation:
      | {
          id: string;
          student:
            | {
                id: string;
                name: string;
                parent_phone: string | null;
              }
            | null;
        }
      | null;
  };

  const { data, error } = (await supabase
    .from("crm_seminar_invitation_items")
    .select(
      `
        id,
        signed_at,
        status,
        invitation_id,
        invitation:crm_seminar_invitations!inner(
          id,
          student:crm_students!inner(id, name, parent_phone)
        )
      `,
    )
    .eq("seminar_id", seminarId)
    .eq("status", "signed")
    .order("signed_at", { ascending: false })) as unknown as {
    data: Row[] | null;
    error: { message: string } | null;
  };

  if (error) {
    throw new Error(`신청자 명단 조회에 실패했습니다: ${error.message}`);
  }

  const rows = data ?? [];
  return rows
    .map<InvitationSignupRow | null>((r) => {
      const student = r.invitation?.student;
      if (!student) return null;
      return {
        item_id: r.id,
        invitation_id: r.invitation_id,
        student_id: student.id,
        student_name: student.name,
        parent_phone: student.parent_phone ?? "",
        status: r.status,
        signed_at: r.signed_at,
      };
    })
    .filter((v): v is InvitationSignupRow => v !== null);
}
