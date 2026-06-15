/**
 * 강좌 상세 (`/classes/[id]`) 의 "공개 신청 페이지" 섹션 데이터 로더.
 *
 * subject='설명회' 강좌에 부착된 crm_class_signup_pages 와 신청 명단을 가져온다.
 * 0084 새 모델 기반. dev-seed 는 페이지 부재 — null 반환.
 *
 * 권한:
 *   호출부(page server component) 가 분원 가드. 본 함수는 RLS 만 신뢰.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import type { InvitationItemStatus } from "@/types/database";

/** 학부모(=학생) 1명 = 신청 1행 (signed 만 노출). */
export interface ClassSignupParentRow {
  item_id: string;
  student_id: string;
  student_name: string;
  /** 학생 학교 — 인쇄용 명단 표기에 사용. */
  school: string | null;
  /** 학생 학년 — 인쇄용 명단 표기에 사용. */
  grade: string | null;
  parent_phone: string | null;
  signed_at: string;
  /** 운영자가 전체 명단에 수동 편입했는지(roster_added). 미적용 DB 면 false. */
  added: boolean;
}

export interface ClassSignupPageDetail {
  /** null = 아직 페이지 미생성 (강좌만 있음). 발송 시점에 자동 생성됨. */
  page: {
    id: string;
    status: "draft" | "open" | "closed";
    held_at: string | null;
    signup_opens_at: string | null;
    signup_closes_at: string | null;
    description: string | null;
    capacity_override: number | null;
    created_at: string;
    updated_at: string;
  } | null;
  /** items 상태별 카운트. 페이지 없으면 모두 0. */
  signed_count: number;
  pending_count: number;
  cancelled_count: number;
  /** 신청 완료 학부모·학생 명단 (signed_at DESC). */
  signed_parents: ClassSignupParentRow[];
}

const EMPTY: ClassSignupPageDetail = {
  page: null,
  signed_count: 0,
  pending_count: 0,
  cancelled_count: 0,
  signed_parents: [],
};

export async function getClassSignupPage(
  classId: string,
): Promise<ClassSignupPageDetail> {
  if (!classId || classId.trim().length === 0) return EMPTY;
  if (isDevSeedMode()) return EMPTY;

  const supabase = await createSupabaseServerClient();

  // 1) 강좌에 부착된 페이지 (1:1, UNIQUE class_id).
  type PageRow = {
    id: string;
    status: "draft" | "open" | "closed";
    held_at: string | null;
    signup_opens_at: string | null;
    signup_closes_at: string | null;
    description: string | null;
    capacity_override: number | null;
    created_at: string;
    updated_at: string;
  };
  const { data: pageData, error: pageError } = (await supabase
    .from("crm_class_signup_pages")
    .select(
      "id, status, held_at, signup_opens_at, signup_closes_at, description, capacity_override, created_at, updated_at",
    )
    .eq("class_id", classId)
    .maybeSingle()) as unknown as {
    data: PageRow | null;
    error: { message: string } | null;
  };
  if (pageError) {
    throw new Error(
      `신청 페이지 조회에 실패했습니다: ${pageError.message}`,
    );
  }
  if (!pageData) return EMPTY;

  // 2) items + 학생 메타 (PostgREST embed). status 카운트는 in-memory.
  type ItemRow = {
    id: string;
    status: InvitationItemStatus;
    signed_at: string | null;
    roster_added?: boolean;
    invitation: {
      id: string;
      student_id: string;
      student: {
        id: string;
        name: string;
        school: string | null;
        grade: string | null;
        parent_phone: string | null;
      } | null;
    } | null;
  };
  // roster_added(0092) 포함 조회. 마이그레이션 미적용 DB 면 컬럼이 없어 에러가
  // 나므로, 그 경우 roster_added 없이 재조회한다(전부 added=false 로 동작).
  const selectWith = (withRoster: boolean) =>
    supabase
      .from("crm_class_signup_items")
      .select(
        `id, status, signed_at${withRoster ? ", roster_added" : ""},
       invitation:crm_class_signup_invitations!inner(
         id,
         student_id,
         student:crm_students!inner(id, name, school, grade, parent_phone)
       )`,
      )
      .eq("signup_page_id", pageData.id)
      .order("signed_at", { ascending: false, nullsFirst: false });

  let { data: itemRows, error: itemError } = (await selectWith(
    true,
  )) as unknown as {
    data: ItemRow[] | null;
    error: { message: string } | null;
  };
  if (itemError && /roster_added/.test(itemError.message)) {
    ({ data: itemRows, error: itemError } = (await selectWith(
      false,
    )) as unknown as {
      data: ItemRow[] | null;
      error: { message: string } | null;
    });
  }
  if (itemError) {
    throw new Error(`신청 명단 조회에 실패했습니다: ${itemError.message}`);
  }

  let signed = 0;
  let pending = 0;
  let cancelled = 0;
  const signedParents: ClassSignupParentRow[] = [];
  for (const r of itemRows ?? []) {
    if (r.status === "signed") signed += 1;
    else if (r.status === "pending") pending += 1;
    else if (r.status === "cancelled") cancelled += 1;
    if (
      r.status === "signed" &&
      r.signed_at &&
      r.invitation?.student
    ) {
      signedParents.push({
        item_id: r.id,
        student_id: r.invitation.student.id,
        student_name: r.invitation.student.name,
        school: r.invitation.student.school,
        grade: r.invitation.student.grade,
        parent_phone: r.invitation.student.parent_phone,
        signed_at: r.signed_at,
        added: r.roster_added === true,
      });
    }
  }

  return {
    page: pageData,
    signed_count: signed,
    pending_count: pending,
    cancelled_count: cancelled,
    signed_parents: signedParents,
  };
}
