/**
 * 설명회 invitation 통계 / 명단 (운영자) — 0082 invitation 모델.
 *
 * "이 설명회로 보낸 학생 명단" 과 "그 중 신청한 학생 수" 를 동시에 보여주기 위한
 * 로더. `/seminars/[id]` 페이지의 신청률 표시 + 발송 명단 패널이 사용.
 *
 * 흐름:
 *  - 이 설명회 ID 에 매달린 `crm_seminar_invitation_items` 를 모두 읽는다.
 *  - 카운트 3종 분류: signed / pending / cancelled.
 *  - 옵션으로 학생 메타까지 펼쳐 명단 목록도 같이 반환.
 *
 * 권한: page 레이어가 master/admin + 분원 검사. 로더는 RLS 의존.
 *
 * dev-seed: 가짜 invitation 명단을 합성해 신청률 카드/명단이 비어 보이지 않게.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { listMockSignups } from "@/lib/seminars/dev-seed";
import type { InvitationItemStatus } from "@/types/database";

/** 설명회별 invitation 카운트 — 신청률 카드 표시용. */
export interface SeminarInvitationCounts {
  /** 발송된 총 invitation 카드 수 (= 학생 수). */
  total: number;
  /** 학부모가 [신청하기] 클릭한 카드 수. */
  signed: number;
  /** 발송됐지만 아직 안 누른 카드 수. */
  pending: number;
  /** 운영자가 취소한 카드 수. */
  cancelled: number;
}

/** 설명회 invitation 명단 1행 — total/signed 와 함께 학생 누구에게 보냈는지. */
export interface SeminarInvitationRowItem {
  item_id: string;
  invitation_id: string;
  student_id: string;
  student_name: string;
  /** 숫자만 정규화 저장. 호출부에서 권한별 마스킹. */
  parent_phone: string;
  status: InvitationItemStatus;
  signed_at: string | null;
  /** 발송 시각 (= invitation.created_at). */
  invited_at: string;
}

/**
 * 카운트만 가볍게 (page 상단 카드용).
 */
export async function getInvitationCounts(
  seminarId: string,
): Promise<SeminarInvitationCounts> {
  if (typeof seminarId !== "string" || seminarId.length === 0) {
    return { total: 0, signed: 0, pending: 0, cancelled: 0 };
  }
  if (isDevSeedMode()) {
    return countFromDevSeed(seminarId);
  }
  return countFromSupabase(seminarId);
}

/**
 * 보낸 명단 전체 (카드 N개) — 학생 메타 펼쳐서 반환. signed_at DESC 정렬.
 *
 * "신청률 / 발송 명단" 두 가지를 한 번에 가지고 있어야 하는 화면은
 * `getInvitationCounts` 와 별도로 본 함수를 호출.
 */
export async function listInvitations(
  seminarId: string,
): Promise<SeminarInvitationRowItem[]> {
  if (typeof seminarId !== "string" || seminarId.length === 0) return [];
  if (isDevSeedMode()) {
    return listFromDevSeed(seminarId);
  }
  return listFromSupabase(seminarId);
}

// ─── dev-seed ─────────────────────────────────────────────────

function countFromDevSeed(seminarId: string): SeminarInvitationCounts {
  const all = listMockSignups(seminarId);
  const signed = all.filter((s) => s.status === "active").length;
  const cancelled = all.filter((s) => s.status === "cancelled").length;
  // 운영 시연 시 "신청률" 이 의미 있도록 가상의 발송 모수를 신청수+α 로 가정.
  // 신청자수보다 2배 정도 보냈다고 보면 "절반 정도 신청" 이라는 자연스러운 비율.
  const totalSent = Math.max(all.length, signed * 2);
  const pending = Math.max(0, totalSent - signed - cancelled);
  return { total: totalSent, signed, pending, cancelled };
}

function listFromDevSeed(seminarId: string): SeminarInvitationRowItem[] {
  return listMockSignups(seminarId).map<SeminarInvitationRowItem>((m) => ({
    item_id: `dev-item-${m.id}`,
    invitation_id: `dev-inv-${m.id}`,
    student_id: `dev-student-${m.id}`,
    student_name: m.student_name,
    parent_phone: m.parent_phone,
    status: m.status === "active" ? "signed" : "cancelled",
    signed_at: m.status === "active" ? m.signed_up_at : null,
    invited_at: m.signed_up_at,
  }));
}

// ─── Supabase ────────────────────────────────────────────────

async function countFromSupabase(
  seminarId: string,
): Promise<SeminarInvitationCounts> {
  const supabase = await createSupabaseServerClient();

  // 단일 SELECT 후 클라이언트 측 집계 — 카운트 분기 3종을 head:count 로 따로
  // 보내면 라운드트립이 늘어난다. invitation_items 는 설명회당 수십~수백 건이라
  // 단일 SELECT 가 가벼움.
  const { data, error } = (await supabase
    .from("crm_seminar_invitation_items")
    .select("status")
    .eq("seminar_id", seminarId)) as unknown as {
    data: Array<{ status: InvitationItemStatus }> | null;
    error: { message: string } | null;
  };

  if (error) {
    throw new Error(`발송 카운트 조회에 실패했습니다: ${error.message}`);
  }

  const rows = data ?? [];
  let signed = 0;
  let pending = 0;
  let cancelled = 0;
  for (const r of rows) {
    if (r.status === "signed") signed += 1;
    else if (r.status === "pending") pending += 1;
    else if (r.status === "cancelled") cancelled += 1;
  }
  return { total: rows.length, signed, pending, cancelled };
}

async function listFromSupabase(
  seminarId: string,
): Promise<SeminarInvitationRowItem[]> {
  const supabase = await createSupabaseServerClient();

  type Row = {
    id: string;
    signed_at: string | null;
    status: InvitationItemStatus;
    invitation_id: string;
    invitation:
      | {
          id: string;
          created_at: string;
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
          created_at,
          student:crm_students!inner(id, name, parent_phone)
        )
      `,
    )
    .eq("seminar_id", seminarId)
    // signed 가 먼저, 그 안에선 signed_at DESC.
    .order("signed_at", { ascending: false, nullsFirst: false })) as unknown as {
    data: Row[] | null;
    error: { message: string } | null;
  };

  if (error) {
    throw new Error(`발송 명단 조회에 실패했습니다: ${error.message}`);
  }

  const rows = data ?? [];
  return rows
    .map<SeminarInvitationRowItem | null>((r) => {
      const inv = r.invitation;
      const student = inv?.student;
      if (!inv || !student) return null;
      return {
        item_id: r.id,
        invitation_id: r.invitation_id,
        student_id: student.id,
        student_name: student.name,
        parent_phone: student.parent_phone ?? "",
        status: r.status,
        signed_at: r.signed_at,
        invited_at: inv.created_at,
      };
    })
    .filter((v): v is SeminarInvitationRowItem => v !== null);
}
