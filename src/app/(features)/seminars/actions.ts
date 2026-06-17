"use server";

/**
 * F5 · 설명회 Server Actions (0084/0085 새 모델).
 *
 * Phase 2-B-3 (2026-06-02) 정리: 옛 crm_seminars CRUD 액션(create/update/change-
 * status/submitSignup/exportSignups) 모두 폐기. 새 모델 위에서 다음만 노출:
 *
 * 액션 인벤토리:
 *   - cancelSignupAction            : invitation_items 단건 취소 (운영자).
 *   - createSeminarBroadcastAction  : 강좌 선택 → invitation/items 생성 + 발송.
 *   - claimInvitationItemAction     : 학부모 [신청] 클릭 (anon, claim_signup_item RPC).
 *   - upsertClassSignupPageAction   : 강좌 상세에서 신청 페이지 옵션 저장.
 *
 * 공통 정책:
 *   - dev-seed 모드는 모든 쓰기 액션이 `{ status: 'dev_seed_mode' }` 즉시 반환.
 *   - 권한: `can(user, 'write', 'group', branch)` 패턴 미러.
 *   - 입력 검증: Zod 스키마 재검증.
 */

import { revalidatePath } from "next/cache";
import { waitUntil } from "@vercel/functions";
import { ZodError } from "zod";
import { loadRecipientsByFilters } from "@/lib/groups/load-all-group-recipients";
import { sendonFromNumber } from "@/config/sender-numbers";

import {
  CancelSignupInputSchema,
  CreateBroadcastInputSchema,
  ClaimInvitationItemInputSchema,
  CreateSeminarInputSchema,
  UpsertClassSignupPageInputSchema,
  type CancelSignupInput,
  type CreateBroadcastInput,
  type ClaimInvitationItemInput,
  type CreateSeminarInput,
  type UpsertClassSignupPageInput,
} from "@/lib/schemas/seminar";
import { generateLinkToken } from "@/lib/seminars/generate-link-token";
import {
  buildInviteUrl,
  INVITE_LINK_TOKEN,
  SENDON_INVITE_PLACEHOLDER,
} from "@/lib/seminars/dispatch-broadcast";
import { getMessagingBaseUrl } from "@/lib/messaging/base-url";
import { testSend } from "@/lib/messaging/test-send";
import type { SendCampaignResult } from "@/lib/messaging/send-campaign";
import { formatPhone } from "@/lib/phone";
import { getUnsubscribedPhones } from "@/lib/messaging/unsubscribed-phones";
import { countEucKrBytes } from "@/lib/messaging/sms-bytes";
import { BYTE_LIMITS } from "@/lib/schemas/template";
import {
  insertSenderHeader,
  insertUnsubscribeFooter,
  checkQuietHours,
  branchBrandName,
} from "@/lib/messaging/guards";
import {
  createSupabaseServerClient,
  createSupabaseServiceClient,
} from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/can";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { normalizePhone } from "@/lib/phone";
import type { ClaimInvitationItemResult, CurrentUser } from "@/types/database";

// ─── 결과 타입 ──────────────────────────────────────────────

/**
 * 설명회 생성 결과.
 *
 * 0082: `link_token` 필드는 영구 폐기 컬럼이지만, 호출처(new-seminar-form)와
 * 테스트(seminars-actions-guards)의 컴파일 호환을 위해 응답 필드는 유지하고
 * 빈 문자열을 넣는다. 다음 PR 에서 호출처가 invitation 흐름으로 옮긴 뒤 제거.
 */
export type CancelSignupActionResult =
  | { status: "success" }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode" };

/**
 * 학부모 신청 결과.
 *
 * status 는 signup_for_seminar RPC enum 을 그대로 펼친다 — 호출부 switch 가 단순해진다.
 *   - 'signed'        : 정상 접수
 *   - 'duplicate'     : 이미 신청된 학생 (signup_id 는 기존 row)
 *   - 'closed'        : 정원 마감
 *   - 'ended'         : 행사 종료
 *   - 'cancelled'     : 설명회 취소
 *   - 'out_of_window' : 신청 창 밖
 *   - 'invalid'       : 토큰 / 입력 오류
 *   - 'failed'        : 인프라/네트워크 오류 (RPC 자체 실패)
 *   - 'dev_seed_mode' : 시드 모드 — UI 가 별도 토스트
 */
export type CreateSeminarBroadcastActionResult =
  | {
      status: "success";
      campaign_id: string;
      /**
       * 발송 큐에 적재된 건수(=대상 학생 수). 실제 발송은 백그라운드 드레인 워커가
       * 청크씩 진행하므로, 즉시 반환 시점엔 성공/실패 카운트가 아직 0이다.
       * 진행률은 캠페인 상세(CampaignProgressPoller)에서 확인한다.
       */
      queued: number;
      /** 예약 발송이면 예약 시각(ISO), 즉시 발송이면 null. */
      scheduledAt?: string | null;
    }
  | { status: "blocked"; reason: string }
  | { status: "failed"; reason: string }
  | {
      status: "dev_seed_mode";
      sent: number;
      invitation_count: number;
    };

/**
 * 학부모 [신청하기] 클릭 결과 — flat union.
 *
 * RPC enum 을 status 로 그대로 펼친다 (frontend parent-invitation-flow.tsx 가
 * status 자체로 단일 switch). dev_seed_mode / failed 는 인프라 분기.
 *
 *  - signed         : 정상 접수 (pending → signed)
 *  - already_signed : 멱등 (이미 signed — 재클릭 무해)
 *  - limit_reached  : 중복 신청 불가(allow_multiple=false) 인데 이미 다른 카드 signed (0087)
 *  - closed         : 정원 마감
 *  - ended          : 행사 종료
 *  - cancelled      : 설명회·카드 취소
 *  - invalid        : 토큰/매핑 오류
 *  - out_of_window  : 신청 창 밖
 *  - failed         : 인프라/네트워크 오류 (RPC 자체 실패)
 *  - dev_seed_mode  : 시연 모드
 */
export type ClaimInvitationItemActionResult =
  | {
      status:
        | "signed"
        | "already_signed"
        | "limit_reached"
        | "closed"
        | "ended"
        | "cancelled"
        | "invalid"
        | "out_of_window";
      itemId: string | null;
      reason: string | null;
    }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode" };

// ─── 권한 가드 ─────────────────────────────────────────────

type AuthOk = { ok: true; user: CurrentUser };
type AuthFail = { ok: false; reason: string };

/**
 * 로그인 + 쓰기 권한 검사. 분원 인자가 주어지면 본인 분원 일치 여부도 확인.
 * dev-seed 분기는 호출 전에 isDevSeedMode() 로 처리.
 */
async function assertSeminarWrite(branch?: string): Promise<AuthOk | AuthFail> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, reason: "로그인 후 이용 가능합니다" };
  if (!user.active) return { ok: false, reason: "비활성 계정입니다" };
  // 'group' 리소스로 매핑 — master/admin 만 통과.
  if (!can(user, "write", "group", branch)) {
    return {
      ok: false,
      reason: "권한이 없습니다 (master / 본인 분원 admin 만 가능)",
    };
  }
  return { ok: true, user };
}

function zodErrorToReason(err: ZodError): string {
  const first = err.issues[0];
  if (!first) return "입력 값이 올바르지 않습니다";
  return first.message || "입력 값이 올바르지 않습니다";
}

// ─── cancelSignupAction (0082 — invitation_items 단건 취소) ───
//
// 0080 폼 모델에선 `crm_seminar_signups` 1행 = 1 신청. 0082 부터는
// `crm_seminar_invitation_items.status='signed'` 1행 = 1 신청 이고, 운영자가
// 취소하면 그 카드의 status='cancelled' 로 soft delete.
//
// CancelSignupInputSchema 의 필드명은 호환 유지를 위해 `signup_id` 로 두지만,
// 의미적으로는 `crm_seminar_invitation_items.id` 다 — UI/액션 호출부에서 카드
// PK 를 그대로 넘기면 된다.
export async function cancelSignupAction(
  input: CancelSignupInput,
): Promise<CancelSignupActionResult> {
  if (isDevSeedMode()) return { status: "dev_seed_mode" };

  let parsed: CancelSignupInput;
  try {
    parsed = CancelSignupInputSchema.parse(input);
  } catch (e) {
    if (e instanceof ZodError) {
      return { status: "failed", reason: zodErrorToReason(e) };
    }
    return { status: "failed", reason: "입력 값이 올바르지 않습니다" };
  }

  const supabase = await createSupabaseServerClient();

  // 카드 → invitation → 분원 lookup (PostgREST nested select).
  type Row = {
    id: string;
    status: string;
    invitation:
      | {
          id: string;
          branch: string;
        }
      | null;
  };
  const { data: item, error: fetchError } = (await supabase
    .from("crm_class_signup_items")
    .select(
      `id, status, invitation:crm_class_signup_invitations!inner(id, branch)`,
    )
    .eq("id", parsed.signup_id)
    .maybeSingle()) as unknown as {
    data: Row | null;
    error: { message: string } | null;
  };

  if (fetchError) {
    return {
      status: "failed",
      reason: `신청 조회에 실패했습니다: ${fetchError.message}`,
    };
  }
  if (!item || !item.invitation) {
    return { status: "failed", reason: "존재하지 않는 신청입니다" };
  }
  if (item.status === "cancelled") {
    // 이미 취소 — idempotent 성공.
    return { status: "success" };
  }

  const branch = item.invitation.branch;
  const auth = await assertSeminarWrite(branch);
  if (!auth.ok) return { status: "failed", reason: auth.reason };

  const { error: updateError } = (await (
    supabase.from("crm_class_signup_items") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (
          col: string,
          val: string,
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: auth.user.user_id,
      // signed_at 은 CHECK 제약(signed 일 때만 NOT NULL) — cancelled 전이 시 NULL 로.
      signed_at: null,
    })
    .eq("id", parsed.signup_id)) as {
    error: { message: string } | null;
  };

  if (updateError) {
    return {
      status: "failed",
      reason: `신청 취소에 실패했습니다: ${updateError.message}`,
    };
  }

  // invitation_id 기준 캐시 무효화 — 어느 설명회 페이지에 속해 있는지는 호출부가 알기 어려워
  // /seminars 전체 무효화.
  revalidatePath("/seminars/compose");
  return { status: "success" };
}

// ─── setSignupRosterAddedAction (전체 명단 편입 토글, 비파괴) ──
//
// CRM 신청자를 설명회 '전체 명단' 에 편입(roster_added=true)하거나 되돌린다(false).
// 신청 status 는 건드리지 않으므로 신청이 삭제/취소되지 않는다.
export type SetRosterAddedActionResult =
  | { status: "success" }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode" };

export async function setSignupRosterAddedAction(
  itemId: string,
  added: boolean,
): Promise<SetRosterAddedActionResult> {
  if (isDevSeedMode()) return { status: "dev_seed_mode" };
  if (typeof itemId !== "string" || itemId.length === 0) {
    return { status: "failed", reason: "신청 ID 가 유효하지 않습니다" };
  }

  const supabase = await createSupabaseServerClient();

  type Row = {
    id: string;
    invitation: { branch: string } | null;
  };
  const { data: item, error: fetchError } = (await supabase
    .from("crm_class_signup_items")
    .select(`id, invitation:crm_class_signup_invitations!inner(branch)`)
    .eq("id", itemId)
    .maybeSingle()) as unknown as {
    data: Row | null;
    error: { message: string } | null;
  };
  if (fetchError) {
    return { status: "failed", reason: `신청 조회 실패: ${fetchError.message}` };
  }
  if (!item || !item.invitation) {
    return { status: "failed", reason: "존재하지 않는 신청입니다" };
  }

  const auth = await assertSeminarWrite(item.invitation.branch);
  if (!auth.ok) return { status: "failed", reason: auth.reason };

  const { error: upErr } = (await (
    supabase.from("crm_class_signup_items") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (
          col: string,
          val: string,
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )
    .update({ roster_added: added })
    .eq("id", itemId)) as { error: { message: string } | null };
  if (upErr) {
    return { status: "failed", reason: `명단 편입 처리 실패: ${upErr.message}` };
  }

  revalidatePath("/seminars/compose");
  return { status: "success" };
}

// ─── setSignupsRosterAddedAction (여러 건 한번에 편입/되돌리기) ──
//
// 체크한 CRM 신청 여러 건을 한 번에 전체 명단으로 편입(added=true)하거나
// 되돌린다(false). 단일 토글과 동일하게 비파괴(신청 status 불변).
export async function setSignupsRosterAddedAction(
  itemIds: string[],
  added: boolean,
): Promise<SetRosterAddedActionResult> {
  if (isDevSeedMode()) return { status: "dev_seed_mode" };
  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    return { status: "failed", reason: "선택된 신청이 없습니다" };
  }

  const supabase = await createSupabaseServerClient();

  type Row = { id: string; invitation: { branch: string } | null };
  const { data: items, error: fetchError } = (await supabase
    .from("crm_class_signup_items")
    .select(`id, invitation:crm_class_signup_invitations!inner(branch)`)
    .in("id", itemIds)) as unknown as {
    data: Row[] | null;
    error: { message: string } | null;
  };
  if (fetchError) {
    return { status: "failed", reason: `신청 조회 실패: ${fetchError.message}` };
  }
  const rows = (items ?? []).filter((r) => r.invitation);
  if (rows.length === 0) {
    return { status: "failed", reason: "존재하지 않는 신청입니다" };
  }

  // 모든 항목은 같은 설명회(=같은 분원) 소속이어야 한다.
  const branches = new Set(rows.map((r) => r.invitation!.branch));
  if (branches.size !== 1) {
    return { status: "failed", reason: "분원이 섞여 있어 처리할 수 없습니다" };
  }
  const auth = await assertSeminarWrite([...branches][0]);
  if (!auth.ok) return { status: "failed", reason: auth.reason };

  const ids = rows.map((r) => r.id);
  const { error: upErr } = (await (
    supabase.from("crm_class_signup_items") as unknown as {
      update: (v: Record<string, unknown>) => {
        in: (
          col: string,
          vals: string[],
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )
    .update({ roster_added: added })
    .in("id", ids)) as { error: { message: string } | null };
  if (upErr) {
    return { status: "failed", reason: `명단 편입 처리 실패: ${upErr.message}` };
  }

  revalidatePath("/seminars/compose");
  return { status: "success" };
}

// ─── cancelSignupsAction (여러 신청 한번에 취소/삭제) ──────────
//
// 체크한 CRM 신청 여러 건을 한 번에 취소(status='cancelled')한다. 소프트 삭제라
// 행은 보존(cancelled_at/by 기록)되며 명단(signed)에서만 사라진다 — 테스트 신청
// 정리 등에 사용. 단건 cancelSignupAction 의 배치 버전.
export type CancelSignupsActionResult =
  | { status: "success"; cancelled: number }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode" };

export async function cancelSignupsAction(
  itemIds: string[],
): Promise<CancelSignupsActionResult> {
  if (isDevSeedMode()) return { status: "dev_seed_mode" };
  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    return { status: "failed", reason: "선택된 신청이 없습니다" };
  }

  const supabase = await createSupabaseServerClient();

  type Row = { id: string; invitation: { branch: string } | null };
  const { data: items, error: fetchError } = (await supabase
    .from("crm_class_signup_items")
    .select(`id, invitation:crm_class_signup_invitations!inner(branch)`)
    .in("id", itemIds)) as unknown as {
    data: Row[] | null;
    error: { message: string } | null;
  };
  if (fetchError) {
    return { status: "failed", reason: `신청 조회 실패: ${fetchError.message}` };
  }
  const rows = (items ?? []).filter((r) => r.invitation);
  if (rows.length === 0) {
    return { status: "failed", reason: "존재하지 않는 신청입니다" };
  }
  const branches = new Set(rows.map((r) => r.invitation!.branch));
  if (branches.size !== 1) {
    return { status: "failed", reason: "분원이 섞여 있어 처리할 수 없습니다" };
  }
  const auth = await assertSeminarWrite([...branches][0]);
  if (!auth.ok) return { status: "failed", reason: auth.reason };

  const ids = rows.map((r) => r.id);
  const { error: upErr } = (await (
    supabase.from("crm_class_signup_items") as unknown as {
      update: (v: Record<string, unknown>) => {
        in: (
          col: string,
          vals: string[],
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: auth.user.user_id,
      // signed_at 은 CHECK 제약(signed 일 때만 NOT NULL) — cancelled 전이 시 NULL.
      signed_at: null,
    })
    .in("id", ids)) as { error: { message: string } | null };
  if (upErr) {
    return { status: "failed", reason: `신청 삭제 처리 실패: ${upErr.message}` };
  }

  revalidatePath("/seminars/compose");
  return { status: "success", cancelled: ids.length };
}

// ─── addManualSignupAction (운영자 수동 신청 추가) ──────────
//
// 설명회 명단에서 운영자가 학생을 'CRM 신청생'에 직접 추가(전체 데이터 → 신청).
// (학생, signup_page) 단위 1회만 — 이미 signed 면 멱등(0091 과 동일 기준). invitation 은
// 학생의 기존 것을 재사용, 없으면 campaign_id=null 로 생성. 제거는 cancelSignupAction.
export type AddManualSignupActionResult =
  | { status: "success"; item_id: string }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode" };

export async function addManualSignupAction(input: {
  signupPageId: string;
  studentId: string;
}): Promise<AddManualSignupActionResult> {
  if (isDevSeedMode()) return { status: "dev_seed_mode" };

  const signupPageId =
    typeof input?.signupPageId === "string" ? input.signupPageId.trim() : "";
  const studentId =
    typeof input?.studentId === "string" ? input.studentId.trim() : "";
  if (!signupPageId || !studentId) {
    return { status: "failed", reason: "입력 값이 올바르지 않습니다" };
  }

  const supabase = await createSupabaseServerClient();

  // 1) signup_page → branch/class_id.
  const { data: page, error: pageErr } = (await supabase
    .from("crm_class_signup_pages")
    .select("id, class_id, branch")
    .eq("id", signupPageId)
    .maybeSingle()) as unknown as {
    data: { id: string; class_id: string | null; branch: string } | null;
    error: { message: string } | null;
  };
  if (pageErr) {
    return { status: "failed", reason: `신청 페이지 조회 실패: ${pageErr.message}` };
  }
  if (!page) return { status: "failed", reason: "존재하지 않는 신청 페이지입니다" };

  // 2) 권한 (페이지 분원 기준).
  const auth = await assertSeminarWrite(page.branch);
  if (!auth.ok) return { status: "failed", reason: auth.reason };

  // 3) 학생의 invitation 목록(분원 일치). 최신 우선.
  const { data: invRows } = (await supabase
    .from("crm_class_signup_invitations")
    .select("id")
    .eq("student_id", studentId)
    .eq("branch", page.branch)
    .order("created_at", { ascending: false })) as unknown as {
    data: Array<{ id: string }> | null;
  };
  const invIds = (invRows ?? []).map((r) => r.id);

  // 3-2) 이미 이 설명회를 signed 한 카드가 있으면 멱등 성공(중복 생성 방지).
  if (invIds.length > 0) {
    const { data: alreadySigned } = (await supabase
      .from("crm_class_signup_items")
      .select("id")
      .eq("signup_page_id", signupPageId)
      .eq("status", "signed")
      .in("invitation_id", invIds)
      .limit(1)
      .maybeSingle()) as unknown as { data: { id: string } | null };
    if (alreadySigned) {
      return { status: "success", item_id: alreadySigned.id };
    }
  }

  // 4) 붙일 invitation — 기존 최신 재사용, 없으면 생성(토큰 충돌 재시도).
  let invitationId = invIds[0] ?? null;
  if (!invitationId) {
    for (let attempt = 0; attempt < 3 && !invitationId; attempt += 1) {
      const token = generateLinkToken();
      const { data: created, error: invErr } = (await (
        supabase.from("crm_class_signup_invitations") as unknown as {
          insert: (v: Record<string, unknown>) => {
            select: (c: string) => {
              single: () => Promise<{
                data: { id: string } | null;
                error: { message: string; code?: string } | null;
              }>;
            };
          };
        }
      )
        .insert({
          branch: page.branch,
          student_id: studentId,
          link_token: token,
          campaign_id: null,
          created_by: auth.user.user_id,
          allow_multiple: true,
        })
        .select("id")
        .single()) as {
        data: { id: string } | null;
        error: { message: string; code?: string } | null;
      };
      if (!invErr && created) {
        invitationId = created.id;
        break;
      }
      if (invErr?.code === "23505") continue; // 토큰 충돌 재시도
      return {
        status: "failed",
        reason: `초대 생성 실패: ${invErr?.message ?? "알 수 없는 오류"}`,
      };
    }
    if (!invitationId) {
      return { status: "failed", reason: "초대 생성에 실패했습니다(토큰 충돌)" };
    }
  }

  // 5) item upsert — (invitation, page) 기존 행이 있으면 signed 로 전이, 없으면 INSERT.
  const nowIso = new Date().toISOString();
  const { data: itemRow } = (await supabase
    .from("crm_class_signup_items")
    .select("id")
    .eq("invitation_id", invitationId)
    .eq("signup_page_id", signupPageId)
    .maybeSingle()) as unknown as { data: { id: string } | null };

  let itemId: string;
  if (itemRow) {
    const { error: upErr } = (await (
      supabase.from("crm_class_signup_items") as unknown as {
        update: (v: Record<string, unknown>) => {
          eq: (
            c: string,
            val: string,
          ) => Promise<{ error: { message: string } | null }>;
        };
      }
    )
      .update({
        status: "signed",
        signed_at: nowIso,
        cancelled_at: null,
        cancelled_by: null,
      })
      .eq("id", itemRow.id)) as { error: { message: string } | null };
    if (upErr) {
      return { status: "failed", reason: `신청 추가 실패: ${upErr.message}` };
    }
    itemId = itemRow.id;
  } else {
    const { data: ins, error: insErr } = (await (
      supabase.from("crm_class_signup_items") as unknown as {
        insert: (v: Record<string, unknown>) => {
          select: (c: string) => {
            single: () => Promise<{
              data: { id: string } | null;
              error: { message: string } | null;
            }>;
          };
        };
      }
    )
      .insert({
        invitation_id: invitationId,
        signup_page_id: signupPageId,
        status: "signed",
        signed_at: nowIso,
      })
      .select("id")
      .single()) as {
      data: { id: string } | null;
      error: { message: string } | null;
    };
    if (insErr || !ins) {
      return {
        status: "failed",
        reason: `신청 추가 실패: ${insErr?.message ?? "알 수 없는 오류"}`,
      };
    }
    itemId = ins.id;
  }

  if (page.class_id) revalidatePath(`/classes/${page.class_id}`);
  revalidatePath("/seminars/compose");
  return { status: "success", item_id: itemId };
}

// ─── createSeminarBroadcastAction (0082 핵심) ──────────────
//
// 흐름:
//   1) Zod + 권한 가드(=write, 분원 일치).
//   2) 학생들 SELECT — branch 격리. 비활성/탈퇴 제외.
//   3) 수신거부 phone 제거.
//   4) 학생당 link_token + invitation 1행 + items N행 INSERT.
//   5) campaigns 1행 INSERT (status='발송중').
//   6) sendon batch 1회 발송 — Receiver.name 에 학생별 URL 박음.
//   7) 결과에 따라 campaigns.status='완료'/'실패' + total_cost 갱신.
//
// 광고 가드 (2026-06):
//   - 입력 `is_ad=true` 면 일반 /compose 와 동일한 3종 가드 적용.
//     1) `(광고)` prefix (이미 본문 선두에 있으면 스킵)
//     2) `\n무료수신거부 080-XXXX` footer (이미 본문에 "무료수신거부" 가 있으면 스킵)
//     3) 21:00~08:00 KST 발송 차단 (정보성이면 무관)
//   - 가드는 어댑터 호출(dispatchBroadcast) 직전에 본문에 박힌다 — 학생별 URL 합성
//     전 finalBody 단계에서 처리해 EUC-KR 바이트 검증이 가공 후 본문 기준이 되도록.
//   - `is_ad=false` (기본) 면 종전과 동일 — 정보성 안내로 가공 없음.

/** 1회 발송 상한 — send-campaign 과 동일 정책. */
const MAX_INVITATION_RECIPIENTS = 10_000;
/** invitation / messages 벌크 INSERT 청크. Supabase request size 한도 회피. */
const BROADCAST_INSERT_CHUNK = 1_000;
/** invitation.link_token UNIQUE 충돌 시 재시도 한도. */
const INVITATION_TOKEN_RETRY = 3;

/**
 * 강좌(class_ids)별 crm_class_signup_pages find-or-create + 순서/dedupe 정리.
 *
 * createSeminarBroadcastAction 의 2-2 블록을 추출 — seminarTestSendAction 과 공유.
 * 페이지는 강좌 1:1 (UNIQUE class_id). 없으면 status='open' 으로 자동 생성한다.
 *
 * 반환 signupPageIds 는 class_ids 입력 순서를 따르되, 같은 page 가 두 번 나오면
 * (class_ids 중복) 한 번만 담는다 — items UNIQUE(invitation_id, signup_page_id) 방어.
 */
async function findOrCreateSignupPages(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  classIds: string[],
  branch: string,
  createdBy: string,
): Promise<
  { ok: true; signupPageIds: string[] } | { ok: false; reason: string }
> {
  const { data: existingPages, error: pageFetchError } = (await supabase
    .from("crm_class_signup_pages")
    .select("id, class_id")
    .in("class_id", classIds)) as unknown as {
    data: Array<{ id: string; class_id: string }> | null;
    error: { message: string } | null;
  };
  if (pageFetchError) {
    return {
      ok: false,
      reason: `신청 페이지 조회에 실패했습니다: ${pageFetchError.message}`,
    };
  }
  const pageByClass = new Map<string, string>();
  for (const p of existingPages ?? []) pageByClass.set(p.class_id, p.id);

  const toCreatePages = classIds.filter((cid) => !pageByClass.has(cid));
  if (toCreatePages.length > 0) {
    const newPageRows = toCreatePages.map((cid) => ({
      class_id: cid,
      branch,
      status: "open",
      created_by: createdBy,
    }));
    const { data: createdPages, error: createPageError } = (await (
      supabase.from("crm_class_signup_pages") as unknown as {
        insert: (v: Record<string, unknown>[]) => {
          select: (cols: string) => Promise<{
            data: Array<{ id: string; class_id: string }> | null;
            error: { message: string } | null;
          }>;
        };
      }
    )
      .insert(newPageRows)
      .select("id, class_id")) as {
      data: Array<{ id: string; class_id: string }> | null;
      error: { message: string } | null;
    };
    if (createPageError || !createdPages) {
      return {
        ok: false,
        reason: `신청 페이지 생성 실패: ${createPageError?.message ?? "알 수 없는 오류"}`,
      };
    }
    for (const p of createdPages) pageByClass.set(p.class_id, p.id);
  }

  // class_ids 순서대로 signup_page_ids 배열 추출 (items INSERT 에 사용).
  // dedupe: class_ids 가 같은 값을 두 번 가질 경우(클라이언트 버그·재시도) item
  // UNIQUE(invitation_id, signup_page_id) 가 깨지지 않도록 한 번 더 안전망.
  const seenPageIds = new Set<string>();
  const signupPageIds: string[] = [];
  for (const cid of classIds) {
    const pid = pageByClass.get(cid);
    if (!pid) {
      // find-or-create 이후 누락은 사실상 발생 X — 방어.
      throw new Error(`signup_page 매핑 누락: class_id=${cid}`);
    }
    if (seenPageIds.has(pid)) continue;
    seenPageIds.add(pid);
    signupPageIds.push(pid);
  }
  return { ok: true, signupPageIds };
}

export async function createSeminarBroadcastAction(
  input: CreateBroadcastInput,
): Promise<CreateSeminarBroadcastActionResult> {
  // dev-seed: 가짜 결과로 UI 흐름만 확인 — 실 발송·DB 쓰기 X.
  // (filters 만 받으니 실제 학생 수는 알 수 없음 — placeholder 1)
  if (isDevSeedMode()) {
    return {
      status: "dev_seed_mode",
      sent: 1,
      invitation_count: 1,
    };
  }

  // 1) Zod
  let parsed: CreateBroadcastInput;
  try {
    parsed = CreateBroadcastInputSchema.parse(input);
  } catch (e) {
    if (e instanceof ZodError) {
      return { status: "failed", reason: zodErrorToReason(e) };
    }
    return { status: "failed", reason: "입력 값이 올바르지 않습니다" };
  }

  // 권한 가드 (group 리소스 매핑 — 설명회 발송도 동일 정책).
  const auth = await assertSeminarWrite(parsed.branch);
  if (!auth.ok) return { status: "failed", reason: auth.reason };

  // 예약 발송 시각 검증 — 지정 시 sendon 최소 간격(30분) 이후만 허용.
  let scheduledAtDate: Date | null = null;
  if (parsed.scheduled_at) {
    scheduledAtDate = new Date(parsed.scheduled_at);
    if (Number.isNaN(scheduledAtDate.getTime())) {
      return { status: "failed", reason: "예약 시각 형식이 올바르지 않습니다" };
    }
    if (scheduledAtDate.getTime() < Date.now() + 30 * 60_000) {
      return {
        status: "failed",
        reason: "예약 시각은 지금부터 최소 30분 이후여야 합니다",
      };
    }
  }

  const supabase = await createSupabaseServerClient();

  // 발송 상한은 group 펼친 결과 길이로 후속 검증 (아래 4단계).
  // (client 가 student_ids 를 보내지 않으므로 사전 검증 불가.)

  // 2) 강좌(=설명회) 검증 + crm_class_signup_pages find-or-create.
  //    0084/0085 새 모델: 발송 대상은 강좌이고, 학부모 신청은 그 강좌에 부착된
  //    signup_page 를 통해 처리한다. 페이지가 없으면 발송 시점에 자동 생성
  //    (status='open' — 학부모가 곧장 신청 가능. 운영자가 강좌 상세에서 후조정 가능).
  type ClassCheckRow = {
    id: string;
    branch: string;
    subject: string | null;
    active: boolean;
  };
  const { data: classRows, error: classFetchError } = (await supabase
    .from("crm_classes")
    .select("id, branch, subject, active")
    .in("id", parsed.class_ids)) as unknown as {
    data: ClassCheckRow[] | null;
    error: { message: string } | null;
  };
  if (classFetchError) {
    return {
      status: "failed",
      reason: `강좌 조회에 실패했습니다: ${classFetchError.message}`,
    };
  }
  if (!classRows || classRows.length !== parsed.class_ids.length) {
    return {
      status: "failed",
      reason: "존재하지 않는 강좌가 포함되어 있습니다",
    };
  }
  const wrongBranch = classRows.find((c) => c.branch !== parsed.branch);
  if (wrongBranch) {
    return {
      status: "failed",
      reason: "다른 분원의 강좌는 함께 발송할 수 없습니다",
    };
  }
  const notSeminar = classRows.find((c) => c.subject !== "설명회");
  if (notSeminar) {
    return {
      status: "failed",
      reason: "설명회 강좌(subject='설명회')만 발송 대상입니다",
    };
  }
  const inactive = classRows.find((c) => !c.active);
  if (inactive) {
    return {
      status: "failed",
      reason: "비활성 강좌는 발송 대상이 아닙니다",
    };
  }

  // 2-2) 각 강좌의 crm_class_signup_pages find-or-create + 순서·dedupe 정리.
  //      (createSeminarBroadcastAction / seminarTestSendAction 공유 helper.)
  const pagesResult = await findOrCreateSignupPages(
    supabase,
    parsed.class_ids,
    parsed.branch,
    auth.user.user_id,
  );
  if (!pagesResult.ok) {
    return { status: "failed", reason: pagesResult.reason };
  }
  const signupPageIds = pagesResult.signupPageIds;

  // 3) 필터 → 학생 펼침. 수신거부·탈퇴·branch 격리는 `loadRecipientsByFilters`
  //    가 SQL 단에서 모두 처리 (청크/페이지네이션 내장 — URL 한도 안전).
  //    client→server 로 student_ids 를 왕복 전달하지 않아 Cloudflare 414 회피.
  //    분원 격리는 입력 branch 기준(권한 가드 assertSeminarWrite(parsed.branch) 통과)
  //    — 그룹(crm_groups) 의존을 제거하고 일반 SMS 발송과 동일한 filters 경로 사용.
  const recipients = await loadRecipientsByFilters(
    supabase,
    parsed.filters,
    parsed.branch,
    MAX_INVITATION_RECIPIENTS,
  );
  if (recipients.length === 0) {
    return { status: "blocked", reason: "발송 가능한 학생이 없습니다" };
  }
  if (recipients.length > MAX_INVITATION_RECIPIENTS) {
    return {
      status: "blocked",
      reason: `1회 발송 상한(${MAX_INVITATION_RECIPIENTS}명)을 초과했습니다`,
    };
  }
  type StudentRow = {
    id: string;
    name: string;
    parent_phone: string | null;
    branch: string;
    status: string;
  };
  // student.id 기준 dedupe — `loadRecipientsByFilters` 가 JOIN 경로 따라 중복을
  // 흘릴 수 있다(예: 같은 학생이 필터 조건의 여러 갈래에서 매칭). 중복이 있으면
  // invitation 이 학생당 N개 INSERT 되고 invitationByStudent.set 이 마지막만
  // 보존해, items INSERT 에서 (invitation_id, signup_page_id) UNIQUE 가 깨진다
  // (`class_signup_items_unique_pair`). 여기서 한 번 잘라낸다.
  const seenStudentIds = new Set<string>();
  const students: StudentRow[] = [];
  for (const r of recipients) {
    if (!r.id || seenStudentIds.has(r.id)) continue;
    seenStudentIds.add(r.id);
    students.push({
      id: r.id,
      name: r.name,
      parent_phone: r.parent_phone,
      branch: parsed.branch, // loadRecipientsByFilters 가 branch 격리(SQL eq)
      status: r.status,
    });
  }

  // 4) 수신거부 제외 + parent_phone 결측 학생 제외.
  const unsub = new Set(await getUnsubscribedPhones());
  const filtered = students
    .map((s) => ({
      id: s.id,
      name: s.name,
      parent_phone: normalizePhone(s.parent_phone),
    }))
    .filter(
      (s): s is { id: string; name: string; parent_phone: string } =>
        s.parent_phone !== null && !unsub.has(s.parent_phone),
    );
  if (filtered.length === 0) {
    return {
      status: "blocked",
      reason: "수신거부·번호 결측으로 발송 가능한 학생이 없습니다",
    };
  }

  // 5) 광고 야간 차단 — 예약이면 예약 시각 기준(그 시각에 sendon 이 발송).
  //    여기서 즉시 차단하면 학생/캠페인 INSERT 비용 자체를 절약.
  const quiet = checkQuietHours(scheduledAtDate ?? new Date(), parsed.is_ad);
  if (!quiet.allowed) {
    return {
      status: "blocked",
      reason:
        "야간 광고 차단 시간대입니다 (21:00~08:00). 다른 시간에 발송해 주세요.",
    };
  }

  // 6) 본문 + 학생별 URL placeholder 변환 + 광고 가드 가공.
  //    순서:
  //      a. {이름} 토큰 잔존 검사 (본 발송 미지원 — name 슬롯을 URL 로 점유) — 치환 전 원문 기준
  //      b. {초대링크} → #{이름} (sendon Replace 슬롯) — 없으면 본문 끝에 자동 부착
  //      c. is_ad=true 면 (광고) prefix 부착 (이미 있으면 스킵)
  //      d. is_ad=true 면 \n무료수신거부 080-XXXX footer 부착 (이미 있으면 스킵)
  //      e. URL 최장 합성 후 EUC-KR 바이트 한도 검증
  //
  //    가드 헬퍼: insertSenderHeader 는 분원 브랜드명을 본문 맨 위에 항상 붙이고
  //    (광고면 그 위 (광고)), insertUnsubscribeFooter 는 광고일 때만 footer 부착.
  const trimmed = parsed.body.trim();

  // {이름} 토큰이 원문에 남아 있으면 본 발송이 처리 불가 — name 슬롯을 URL 로 점유.
  //   반드시 INVITE_TOKEN → `#{이름}` 치환 *전* 원문 기준으로 검사한다.
  //   (치환 후 finalBody 에는 sendon placeholder `#{이름}` 가 항상 들어가므로
  //    finalBody 로 검사하면 `#{이름}`.includes("{이름}") 가 true 라 자기 자신을 차단함.)
  if (trimmed.includes("{이름}")) {
    return {
      status: "blocked",
      reason: "설명회 발송에서는 {이름} 변수를 사용할 수 없습니다 ({초대링크} 만 지원)",
    };
  }

  let finalBody = trimmed.includes(INVITE_LINK_TOKEN)
    ? trimmed.split(INVITE_LINK_TOKEN).join(SENDON_INVITE_PLACEHOLDER)
    : `${trimmed}\n\n신청: ${SENDON_INVITE_PLACEHOLDER}`;

  // 발신 브랜드 머리(+광고 prefix) — 분원별 브랜드. footer 는 아래.
  finalBody = insertSenderHeader(
    finalBody,
    parsed.is_ad,
    branchBrandName(parsed.branch),
  );
  // optout 우선순위: 입력 > env (`SMS_OPT_OUT_NUMBER`) > 헬퍼 기본값.
  //   parsed.optout_phone 는 null 일 수 있어 undefined 로 정규화 (헬퍼가 env 폴백).
  finalBody = insertUnsubscribeFooter(
    finalBody,
    parsed.is_ad,
    parsed.optout_phone ?? undefined,
  );

  // 본문 바이트 한도 검증 — 학생별 URL 자리(약 50~80자) 예측해 최장 URL 로 산정.
  // sendBody 의 #{이름} 자리는 치환 후 URL 로 늘어남. 가드 prefix/footer 가 포함된
  // finalBody 기준이라 광고 토글 시 자동으로 한도 빡빡해진다.
  const sampleUrl = `${readPublicOriginForActions()}/s/${"X".repeat(12)}`;
  const expandedSample = finalBody.split(SENDON_INVITE_PLACEHOLDER).join(sampleUrl);
  const expandedBytes = countEucKrBytes(expandedSample);
  const byteLimit = parsed.type === "LMS" ? BYTE_LIMITS.LMS : BYTE_LIMITS.SMS;
  if (expandedBytes > byteLimit) {
    return {
      status: "blocked",
      reason: `본문이 ${parsed.type} 한도(${byteLimit}바이트)를 초과합니다 (URL 포함 ${expandedBytes}바이트)`,
    };
  }

  // 6) campaigns INSERT (status='발송중').
  const campaignTitle = `[설명회] ${parsed.subject ?? parsed.body.slice(0, 24)}`;
  const campaignPayload: Record<string, unknown> = {
    title: campaignTitle,
    template_id: null,
    group_id: null,
    scheduled_at: scheduledAtDate ? scheduledAtDate.toISOString() : null,
    sent_at: scheduledAtDate ? null : new Date().toISOString(),
    status: "발송중",
    total_recipients: filtered.length,
    total_cost: 0,
    created_by: auth.user.user_id,
    branch: parsed.branch,
    is_test: false,
    body: parsed.body, // 운영 본문 원형 보존 — 학생별 URL 합성 전.
    subject: parsed.subject,
    type: parsed.type,
    is_ad: parsed.is_ad, // 운영자 토글값. 기본 false(정보성). true 시 가드 가공 본문이 messages 로 적재됨.
    dedupe_by_phone: false,
    send_to_parent: true,
    send_to_student: false,
  };

  const { data: campaignInserted, error: campaignError } = (await (
    supabase.from("crm_campaigns") as unknown as {
      insert: (v: Record<string, unknown>) => {
        select: (cols: string) => {
          single: () => Promise<{
            data: { id: string } | null;
            error: { message: string } | null;
          }>;
        };
      };
    }
  )
    .insert(campaignPayload)
    .select("id")
    .single()) as {
    data: { id: string } | null;
    error: { message: string } | null;
  };
  if (campaignError || !campaignInserted) {
    return {
      status: "failed",
      reason: `캠페인 생성 실패: ${campaignError?.message ?? "알 수 없는 오류"}`,
    };
  }
  const campaignId = campaignInserted.id;

  // 7) invitation 벌크 INSERT (학생당 1행, 1,000건 청크).
  //    기존엔 학생당 1건씩 순차 INSERT 해 5,000명 발송 시 Server Action 타임아웃
  //    (약 5분)에 걸려 발송이 통째로 죽었다(2026-06-11). 청크 벌크 INSERT 로 왕복
  //    N회 → ceil(N/1000)회로 줄여 수만 명도 수 초 안에 적재한다.
  //    link_token UNIQUE(23505) 충돌은 해당 청크를 새 토큰으로 재시도.
  // 분원별 발신번호 사전 검증 — 실제 발송(drain-campaign)도 같은 분원 기준으로
  // 발신번호를 다시 해석한다. 여기서 막아 적재 전에 실패를 알린다.
  const fromNumber = sendonFromNumber(parsed.branch);
  if (!fromNumber || fromNumber.length === 0) {
    await safeMarkCampaignFailed(supabase, campaignId);
    return {
      status: "failed",
      reason: `${parsed.branch} 분원의 발신번호 환경변수가 설정되지 않았습니다`,
    };
  }

  const invitationByStudent = new Map<string, { id: string; token: string }>();
  for (let i = 0; i < filtered.length; i += BROADCAST_INSERT_CHUNK) {
    const slice = filtered.slice(i, i + BROADCAST_INSERT_CHUNK);
    let chunkDone = false;
    let lastError: string | null = null;
    for (
      let attempt = 0;
      attempt < INVITATION_TOKEN_RETRY && !chunkDone;
      attempt += 1
    ) {
      const tokenByStudent = new Map<string, string>();
      const rows = slice.map((s) => {
        const token = generateLinkToken();
        tokenByStudent.set(s.id, token);
        return {
          branch: parsed.branch,
          student_id: s.id,
          link_token: token,
          campaign_id: campaignId,
          created_by: auth.user.user_id,
          // 0087: 위저드 "중복 신청 허용" 체크박스 값. 기본 true(Zod default).
          allow_multiple: parsed.allow_multiple,
        };
      });
      const { data: invRows, error: invError } = (await (
        supabase.from("crm_class_signup_invitations") as unknown as {
          insert: (v: Record<string, unknown>[]) => {
            select: (cols: string) => Promise<{
              data: Array<{ id: string; student_id: string }> | null;
              error: { message: string; code?: string } | null;
            }>;
          };
        }
      )
        .insert(rows)
        .select("id, student_id")) as {
        data: Array<{ id: string; student_id: string }> | null;
        error: { message: string; code?: string } | null;
      };

      if (!invError && invRows) {
        for (const r of invRows) {
          const token = tokenByStudent.get(r.student_id);
          if (token) {
            invitationByStudent.set(r.student_id, { id: r.id, token });
          }
        }
        chunkDone = true;
        break;
      }
      // 23505 = link_token UNIQUE 충돌 — 청크 전체를 새 토큰으로 재시도.
      if (invError?.code === "23505") {
        lastError = "토큰 충돌";
        continue;
      }
      lastError = invError?.message ?? "알 수 없는 오류";
      break;
    }
    if (!chunkDone) {
      await safeMarkCampaignFailed(supabase, campaignId);
      return {
        status: "failed",
        reason: `invitation 생성 실패: ${lastError ?? "알 수 없는 오류"}`,
      };
    }
  }

  // 7-2) invitation_items 벌크 INSERT (학생 × signup_page 매트릭스), 1,000건 청크.
  const itemRows: Array<{
    invitation_id: string;
    signup_page_id: string;
    status: "pending";
  }> = [];
  for (const s of filtered) {
    const inv = invitationByStudent.get(s.id);
    if (!inv) continue;
    for (const pageId of signupPageIds) {
      itemRows.push({
        invitation_id: inv.id,
        signup_page_id: pageId,
        status: "pending",
      });
    }
  }
  for (let i = 0; i < itemRows.length; i += BROADCAST_INSERT_CHUNK) {
    const slice = itemRows.slice(i, i + BROADCAST_INSERT_CHUNK);
    const { error: itemsError } = (await (
      supabase.from("crm_class_signup_items") as unknown as {
        insert: (v: Record<string, unknown>[]) => Promise<{
          error: { message: string } | null;
        }>;
      }
    ).insert(slice)) as { error: { message: string } | null };
    if (itemsError) {
      await safeMarkCampaignFailed(supabase, campaignId);
      return {
        status: "failed",
        reason: `invitation 카드 생성 실패: ${itemsError.message}`,
      };
    }
  }

  // 8) crm_messages(상태 '대기') 벌크 적재 — 실제 발송은 드레인 워커가 청크씩.
  //    학생별 초대 URL 은 드레인의 "초대링크 모드"가 (campaign_id, student_id)로
  //    link_token 을 조회해 sendon name 슬롯에 주입한다(drain-campaign 참조).
  const nowIso = new Date().toISOString();
  for (let i = 0; i < filtered.length; i += BROADCAST_INSERT_CHUNK) {
    const slice = filtered.slice(i, i + BROADCAST_INSERT_CHUNK);
    const messageRows = slice.map((s) => ({
      campaign_id: campaignId,
      student_id: s.id,
      phone: s.parent_phone,
      status: "대기" as const,
      vendor_message_id: null,
      cost: 0,
      sent_at: null,
      delivered_at: null,
      failed_reason: null,
      is_test: false,
      created_at: nowIso,
    }));
    const { error: msgErr } = (await (
      supabase.from("crm_messages") as unknown as {
        insert: (v: Record<string, unknown>[]) => Promise<{
          error: { message: string } | null;
        }>;
      }
    ).insert(messageRows)) as { error: { message: string } | null };
    if (msgErr) {
      await safeMarkCampaignFailed(supabase, campaignId);
      return {
        status: "failed",
        reason: `메시지 큐 적재 실패: ${msgErr.message}`,
      };
    }
  }

  // 9) 드레인 워커 킥 — fire-and-forget. 즉시 반환하고 백그라운드에서 발송 진행.
  //    (send-campaign runImmediateSend 와 동일 패턴 — 일관성·진행률 폴링 공유.)
  const drainSecret = process.env.DRAIN_SECRET;
  if (!drainSecret) {
    await safeMarkCampaignFailed(supabase, campaignId);
    return {
      status: "failed",
      reason: "DRAIN_SECRET 환경변수가 설정되어 있지 않습니다",
    };
  }
  waitUntil(
    fetch(`${getMessagingBaseUrl()}/api/messaging/drain`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-drain-secret": drainSecret,
      },
      body: JSON.stringify({ campaignId }),
      keepalive: true,
    }).catch(() => {
      // 첫 킥 실패는 무시 — 캠페인은 '발송중' 으로 남고 sweep/수동 재킥으로 회복.
    }),
  );

  revalidatePath("/seminars/compose");
  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${campaignId}`);

  return {
    status: "success",
    campaign_id: campaignId,
    queued: filtered.length,
    scheduledAt: scheduledAtDate ? scheduledAtDate.toISOString() : null,
  };
}

/** campaigns.status='실패' 로 안전 갱신 — 부분 INSERT 후 롤백 대용. */
async function safeMarkCampaignFailed(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  campaignId: string,
): Promise<void> {
  await (
    supabase.from("crm_campaigns") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (
          col: string,
          val: string,
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )
    .update({ status: "실패" })
    .eq("id", campaignId);
}

/** dispatch-broadcast 와 동일한 우선순위로 PublicOrigin 결정 (액션 내 byte 산정용). */
function readPublicOriginForActions(): string {
  if (process.env.APP_BASE_URL)
    return process.env.APP_BASE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}

// ─── seminarTestSendAction (위저드 테스트 발송 — 본인 1건) ───
//
// 위저드 "테스트 발송" 카드 전용. 일반 testSend() 와 달리 본문의 {초대링크} 를
// 실제로 열리는 학생 페이지 URL 로 치환해 보낸다.
//
// 동작 요지:
//   1) dev-seed 차단.
//   2) 인증 + 쓰기 권한(assertSeminarWrite, 분원=user.branch).
//   3) 테스트 수신번호 형식 검증.
//   4) 그 번호를 parent_phone 으로 가진 "테스트용 학생" 1명 탐색 (= 내거로).
//   5) class_ids find-or-create → signup_page_ids 확보.
//   6) 그 학생으로 invitation 1행 + items N행 INSERT (campaign_id=null).
//   7) inviteUrl 합성 → 본문 {초대링크} 치환(없으면 끝에 부착).
//   8) testSend() 코어 재사용 (가드·is_test 캠페인·어댑터·비용).
//   9) 발송 결과가 실패/차단이어도 inviteUrl 은 항상 함께 반환 — 운영자가 링크를
//      바로 클릭 검증할 수 있어야 하므로(현 sendon IP 이슈로 발송이 막혀도).
//
// 캐시 무효화 없음: 테스트 발송이라 명단 화면 즉시 갱신 불필요. invitation 은 DB 에
// 남지만 items 가 'pending' 이라 signed 명단엔 안 뜬다(정상).
export type SeminarTestSendInput = {
  /** 위저드에서 선택된 설명회 강좌 id 들 (1개 이상). */
  classIds: string[];
  /** {초대링크} 포함 가능한 raw 본문. */
  body: string;
  subject: string | null;
  type: "SMS" | "LMS" | "ALIMTALK";
  isAd: boolean;
  /** 테스트 수신 번호 (하이픈 무관). */
  toPhone: string;
  /**
   * 중복 신청 허용 여부 (0087). 위저드 체크박스 값을 그대로 받아 테스트
   * invitation 의 allow_multiple 에 반영 → 테스트 링크에서도 실제 발송과 동일한
   * 중복신청 동작(false 시 2번째 카드 'limit_reached')을 재현. 미지정 시 true.
   */
  allowMultiple?: boolean;
};

export async function seminarTestSendAction(
  input: SeminarTestSendInput,
): Promise<SendCampaignResult & { inviteUrl?: string }> {
  // 1) dev-seed 차단 (inviteUrl 없이).
  if (isDevSeedMode()) {
    return { status: "dev_seed_mode", reason: "개발 시드 모드 — 실 발송 차단됨" };
  }

  // 2) 인증 + 쓰기 권한 (분원은 user.branch 기준).
  const user = await getCurrentUser();
  if (!user) {
    return { status: "failed", reason: "로그인 후 이용 가능합니다" };
  }
  const auth = await assertSeminarWrite(user.branch);
  if (!auth.ok) return { status: "failed", reason: auth.reason };

  // classIds 방어 — 최소 1개.
  if (!Array.isArray(input.classIds) || input.classIds.length === 0) {
    return { status: "failed", reason: "설명회 강좌를 1개 이상 선택해 주세요" };
  }

  // 3) 수신번호 형식 검증 (숫자만 추출 후 휴대폰 패턴).
  const phone = input.toPhone.replace(/\D/g, "");
  if (!/^01[016789][0-9]{7,8}$/.test(phone)) {
    return { status: "failed", reason: "휴대폰 번호 형식이 올바르지 않습니다" };
  }

  const supabase = await createSupabaseServerClient();

  // 4) 테스트 수신번호로 등록된 학생 1명 탐색 (= "내거로").
  //    분원으로 묶지 않는다 — 테스트용 학생(본인 번호)이 설명회와 다른 분원에
  //    등록돼 있을 수 있다(예: 대치 설명회 테스트인데 본인 학생은 반포 소속).
  //    접근 권한은 RLS 가 보장(master 는 전 분원, 그 외는 자기 분원만 조회됨).
  //    우선 하이픈 포맷(formatPhone)으로 정확 eq 조회. 없으면 parent_phone 숫자만
  //    추출해 phone 과 매칭 폴백 (뒤 8자리 like 로 후보만 좁힘).
  type StudentMatchRow = {
    id: string;
    name: string;
    branch: string;
    parent_phone: string | null;
  };
  let matchedStudent: StudentMatchRow | null = null;

  const hyphenated = formatPhone(phone);
  {
    const { data, error } = (await supabase
      .from("crm_students")
      .select("id, name, branch, parent_phone")
      .eq("parent_phone", hyphenated)
      .limit(1)
      .maybeSingle()) as unknown as {
      data: StudentMatchRow | null;
      error: { message: string } | null;
    };
    if (error) {
      return {
        status: "failed",
        reason: `학생 조회에 실패했습니다: ${error.message}`,
      };
    }
    matchedStudent = data;
  }

  // 폴백: 포맷이 달라(공백·하이픈 차이) eq 미스인 경우, 뒤 8자리 like 로 후보를
  //       좁힌 뒤 숫자만 비교해 정확 일치 1명 선별 (쿼리 과대 방지).
  if (!matchedStudent) {
    const tail8 = phone.slice(-8);
    const { data: candidates, error: candError } = (await supabase
      .from("crm_students")
      .select("id, name, branch, parent_phone")
      .like("parent_phone", `%${tail8.slice(0, 4)}%${tail8.slice(4)}`)
      .limit(50)) as unknown as {
      data: StudentMatchRow[] | null;
      error: { message: string } | null;
    };
    if (candError) {
      return {
        status: "failed",
        reason: `학생 조회에 실패했습니다: ${candError.message}`,
      };
    }
    matchedStudent =
      (candidates ?? []).find(
        (c) => (c.parent_phone ?? "").replace(/\D/g, "") === phone,
      ) ?? null;
  }

  if (!matchedStudent) {
    return {
      status: "failed",
      reason:
        "이 번호로 등록된 학생이 없어 테스트 링크를 만들 수 없습니다. 본인 번호를 학부모 연락처로 가진 학생(테스트용)을 먼저 등록하세요.",
    };
  }

  // 4-2) 선택된 설명회 강좌의 분원 확인. 페이지·invitation 은 학생 분원이 아니라
  //      설명회(강좌) 분원 기준으로 만들어야 일관적이다 (테스트 학생이 타 분원일 수
  //      있음). 선택된 강좌들은 같은 분원이라는 전제(위저드가 단일 분원).
  const { data: classRows, error: classErr } = (await supabase
    .from("crm_classes")
    .select("id, branch")
    .in("id", input.classIds)) as unknown as {
    data: Array<{ id: string; branch: string }> | null;
    error: { message: string } | null;
  };
  if (classErr) {
    return {
      status: "failed",
      reason: `설명회 강좌 조회에 실패했습니다: ${classErr.message}`,
    };
  }
  const foundClasses = classRows ?? [];
  if (foundClasses.length === 0) {
    return { status: "failed", reason: "선택한 설명회를 찾을 수 없습니다" };
  }
  const classBranch = foundClasses[0].branch;

  // 5) class_ids find-or-create → signup_page_ids (공유 helper). 페이지는 설명회
  //    강좌 분원으로 생성/조회한다.
  const pagesResult = await findOrCreateSignupPages(
    supabase,
    input.classIds,
    classBranch,
    auth.user.user_id,
  );
  if (!pagesResult.ok) {
    return { status: "failed", reason: pagesResult.reason };
  }
  const signupPageIds = pagesResult.signupPageIds;

  // 6) invitation 1행 INSERT (UNIQUE(link_token) 충돌 시 재시도).
  let invitation: { id: string; token: string } | null = null;
  let lastInvError: string | null = null;
  for (let attempt = 0; attempt < INVITATION_TOKEN_RETRY; attempt += 1) {
    const token = generateLinkToken();
    const { data: invRow, error: invError } = (await (
      supabase.from("crm_class_signup_invitations") as unknown as {
        insert: (v: Record<string, unknown>) => {
          select: (cols: string) => {
            single: () => Promise<{
              data: { id: string } | null;
              error: { message: string; code?: string } | null;
            }>;
          };
        };
      }
    )
      .insert({
        branch: classBranch,
        student_id: matchedStudent.id,
        link_token: token,
        campaign_id: null,
        created_by: auth.user.user_id,
        // 0087: 위저드 체크박스 값 반영(미지정 시 true). 실 발송과 동일한 중복신청
        //       동작을 테스트 링크에서도 재현하기 위함.
        allow_multiple: input.allowMultiple ?? true,
      })
      .select("id")
      .single()) as {
      data: { id: string } | null;
      error: { message: string; code?: string } | null;
    };
    if (!invError && invRow) {
      invitation = { id: invRow.id, token };
      break;
    }
    if (invError?.code === "23505") {
      lastInvError = "토큰 충돌";
      continue;
    }
    lastInvError = invError?.message ?? "알 수 없는 오류";
    break;
  }
  if (!invitation) {
    return {
      status: "failed",
      reason: `테스트 invitation 생성 실패: ${lastInvError ?? "알 수 없는 오류"}`,
    };
  }

  // 6-2) items INSERT (invitation × 각 signup_page). UNIQUE(invitation_id,
  //      signup_page_id) 는 signupPageIds 가 이미 dedupe 되어 안전.
  const itemRows = signupPageIds.map((pageId) => ({
    invitation_id: invitation.id,
    signup_page_id: pageId,
    status: "pending" as const,
  }));
  const { error: itemsError } = (await (
    supabase.from("crm_class_signup_items") as unknown as {
      insert: (v: Record<string, unknown>[]) => Promise<{
        error: { message: string } | null;
      }>;
    }
  ).insert(itemRows)) as { error: { message: string } | null };
  if (itemsError) {
    return {
      status: "failed",
      reason: `테스트 invitation 카드 생성 실패: ${itemsError.message}`,
    };
  }

  // 7) inviteUrl 합성.
  const inviteUrl = buildInviteUrl(invitation.token);

  // 8) 본문 치환: {초대링크} 전부 → inviteUrl. 없으면 끝에 부착(위저드 미리보기와 일치).
  const rawBody = input.body;
  const finalBody = rawBody.includes(INVITE_LINK_TOKEN)
    ? rawBody.split(INVITE_LINK_TOKEN).join(inviteUrl)
    : `${rawBody}\n\n신청: ${inviteUrl}`;

  // 9) testSend() 코어 재사용 — 단건이라 name-slot 개인화 불필요(평문 본문 그대로).
  const sendResult = await testSend({
    body: finalBody,
    subject: input.subject,
    type: input.type,
    isAd: input.isAd,
    toPhone: phone,
    // 설명회 테스트도 해당 설명회(강좌)의 분원 번호·브랜드로 나가게.
    branch: classBranch,
  });

  // 10) 발송 실패/차단이어도 invitation 은 이미 생성됨 → inviteUrl 항상 반환.
  return { ...sendResult, inviteUrl };
}

// ─── claimInvitationItemAction (학부모 anon) ────────────────
//
// 학부모가 학생 페이지에서 카드별 [신청하기] 누를 때 호출.
// 0085 `claim_signup_item` RPC (SECURITY DEFINER) 가 정원·창·취소 검증.
// 멱등 — 이미 signed 면 'already_signed' 반환.
export async function claimInvitationItemAction(
  input: ClaimInvitationItemInput,
): Promise<ClaimInvitationItemActionResult> {
  if (isDevSeedMode()) return { status: "dev_seed_mode" };

  const rawToken = typeof input?.token === "string" ? input.token.trim() : "";
  if (rawToken.length === 0) {
    return { status: "failed", reason: "유효하지 않은 링크입니다" };
  }

  let parsed: ClaimInvitationItemInput;
  try {
    parsed = ClaimInvitationItemInputSchema.parse({
      token: rawToken,
      signup_page_id: input.signup_page_id,
    });
  } catch (e) {
    if (e instanceof ZodError) {
      return { status: "failed", reason: zodErrorToReason(e) };
    }
    return { status: "failed", reason: "입력 값이 올바르지 않습니다" };
  }

  // ── 크로스-invitation 중복 신청 차단 ─────────────────────────
  // class ↔ signup_page 는 1:1(UNIQUE class_id) 이라 "같은 설명회 중복"은
  // "같은 signup_page 에 같은 학생이 이미 signed" 인지로 판정한다. 같은 학생에게
  // 발송이 2번 나가 invitation(링크)이 2개여도, 한 번 신청하면 다른 링크는 막힌다.
  // 학부모(anon)는 RLS 로 이 테이블을 못 읽으므로 service client 로 읽기만 확인.
  const svc = createSupabaseServiceClient();
  const { data: invMeta } = (await svc
    .from("crm_class_signup_invitations")
    .select("student_id")
    .eq("link_token", parsed.token)
    .maybeSingle()) as { data: { student_id: string } | null };

  if (invMeta?.student_id) {
    const { data: studentInvs } = (await svc
      .from("crm_class_signup_invitations")
      .select("id")
      .eq("student_id", invMeta.student_id)) as {
      data: { id: string }[] | null;
    };
    const invIds = (studentInvs ?? []).map((r) => r.id);
    if (invIds.length > 0) {
      const { data: dupRows } = (await svc
        .from("crm_class_signup_items")
        .select("id")
        .eq("signup_page_id", parsed.signup_page_id)
        .eq("status", "signed")
        .in("invitation_id", invIds)
        .limit(1)) as { data: { id: string }[] | null };
      if (dupRows && dupRows.length > 0) {
        console.log(
          `[seminars/claim] 중복 차단 token=${parsed.token.slice(0, 4)}**** page=${parsed.signup_page_id}`,
        );
        return {
          status: "already_signed",
          itemId: dupRows[0].id,
          reason: null,
        };
      }
    }
  }

  const supabase = await createSupabaseServerClient();

  // ⚠️ `.bind(supabase)` 필수 — `this` 바인딩 보존.
  const rpcFn = supabase.rpc.bind(supabase) as unknown as (
    fn: "claim_signup_item",
    params: { p_token: string; p_signup_page_id: string },
  ) => Promise<{
    data: ClaimInvitationItemResult[] | null;
    error: { message: string } | null;
  }>;

  const { data, error } = await rpcFn("claim_signup_item", {
    p_token: parsed.token,
    p_signup_page_id: parsed.signup_page_id,
  });

  if (error) {
    return {
      status: "failed",
      reason: `신청 처리에 실패했습니다: ${error.message}`,
    };
  }
  const row = data && data.length > 0 ? data[0] : null;
  if (!row) {
    return { status: "failed", reason: "신청 결과를 받지 못했습니다" };
  }

  // 감사 로그 (토큰은 prefix 4자만, 학부모 정보는 보존 안 함).
  console.log(
    `[seminars/claim] token=${parsed.token.slice(0, 4)}**** page=${parsed.signup_page_id} status=${row.status}`,
  );

  return {
    status: row.status,
    itemId: row.item_id,
    reason: row.reason,
  };
}


// ─── createSeminarAction (CRM 내부 설명회 생성) ──────────────
//
// 아카 ETL 없이 운영자가 직접 설명회(crm_classes, subject='설명회',
// aca_class_id=NULL)를 만들고 공개 신청 페이지(status='open')를 함께 생성한다.
// 권한: assertSeminarWrite(branch) — master 전체 / admin 본 분원만.
export type CreateSeminarActionResult =
  | { status: "success"; classId: string }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode" };

export async function createSeminarAction(
  input: CreateSeminarInput,
): Promise<CreateSeminarActionResult> {
  if (isDevSeedMode()) return { status: "dev_seed_mode" };

  let parsed: CreateSeminarInput;
  try {
    parsed = CreateSeminarInputSchema.parse(input);
  } catch (e) {
    if (e instanceof ZodError) {
      return { status: "failed", reason: zodErrorToReason(e) };
    }
    return { status: "failed", reason: "입력 값이 올바르지 않습니다" };
  }

  const auth = await assertSeminarWrite(parsed.branch);
  if (!auth.ok) return { status: "failed", reason: auth.reason };

  const supabase = await createSupabaseServerClient();

  // 1) crm_classes INSERT — aca_class_id 는 비워둔다(CRM 자체 생성 행).
  //    정원은 crm_classes.capacity 에 저장(claim RPC 가 이 값을 정원으로 사용).
  const { data: cls, error: classErr } = (await (
    supabase.from("crm_classes") as unknown as {
      insert: (v: Record<string, unknown>) => {
        select: (cols: string) => {
          single: () => Promise<{
            data: { id: string } | null;
            error: { message: string } | null;
          }>;
        };
      };
    }
  )
    .insert({
      branch: parsed.branch,
      name: parsed.name,
      subject: "설명회",
      capacity: parsed.capacity,
      active: true,
    })
    .select("id")
    .single()) as {
    data: { id: string } | null;
    error: { message: string } | null;
  };

  if (classErr || !cls) {
    return {
      status: "failed",
      reason: `설명회 생성에 실패했습니다: ${classErr?.message ?? "알 수 없는 오류"}`,
    };
  }

  // 2) 공개 신청 페이지 생성(open). 실패해도 강좌는 이미 생성됐고 발송 시
  //    find-or-create 로 보강되므로, 경고만 남기고 성공으로 처리한다.
  const { error: pageErr } = (await (
    supabase.from("crm_class_signup_pages") as unknown as {
      insert: (v: Record<string, unknown>) => Promise<{
        error: { message: string } | null;
      }>;
    }
  ).insert({
    class_id: cls.id,
    branch: parsed.branch,
    status: "open",
    held_at: parsed.held_at,
    description: parsed.description,
    created_by: auth.user.user_id,
  })) as { error: { message: string } | null };

  if (pageErr) {
    console.warn(
      `[seminars/create] 신청 페이지 생성 실패 class=${cls.id}: ${pageErr.message}`,
    );
  }

  revalidatePath("/seminars");
  return { status: "success", classId: cls.id };
}

// ─── upsertClassSignupPageAction ─────────────────────────
//
// 강좌(=설명회) 별 공개 신청 페이지 옵션 저장 (생성 or 갱신).
// 0084 새 모델 — class_id UNIQUE 라 1 강좌 1 페이지.
//
// 호출 시점:
//   1) 강좌 상세 페이지의 "공개 신청 페이지" 섹션에서 운영자가 저장.
//   2) 발송 액션은 별도 경로(createSeminarBroadcastAction)로 자동 find-or-create
//      하므로 본 액션이 안 불려도 동작에 지장 없음.
//
// 권한: assertSeminarWrite(branch) — master 전체 / admin 본 분원만.
// 동작: ON CONFLICT (class_id) DO UPDATE — DB UNIQUE 제약으로 멱등.
export type UpsertClassSignupPageActionResult =
  | { status: "success"; id: string; created: boolean }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode" };

export async function upsertClassSignupPageAction(
  input: UpsertClassSignupPageInput,
): Promise<UpsertClassSignupPageActionResult> {
  if (isDevSeedMode()) return { status: "dev_seed_mode" };

  let parsed: UpsertClassSignupPageInput;
  try {
    parsed = UpsertClassSignupPageInputSchema.parse(input);
  } catch (e) {
    if (e instanceof ZodError) {
      return { status: "failed", reason: zodErrorToReason(e) };
    }
    return { status: "failed", reason: "입력 값이 올바르지 않습니다" };
  }

  const auth = await assertSeminarWrite(parsed.branch);
  if (!auth.ok) return { status: "failed", reason: auth.reason };

  const supabase = await createSupabaseServerClient();

  // 강좌가 실제로 존재하고 같은 분원이며 subject='설명회' 인지 검증.
  // (다른 분원·일반 강좌로 페이지 만들 수 없게 가드.)
  type ClassCheck = {
    id: string;
    branch: string;
    subject: string | null;
  };
  const { data: cls, error: classError } = (await supabase
    .from("crm_classes")
    .select("id, branch, subject")
    .eq("id", parsed.class_id)
    .maybeSingle()) as unknown as {
    data: ClassCheck | null;
    error: { message: string } | null;
  };
  if (classError) {
    return {
      status: "failed",
      reason: `강좌 조회에 실패했습니다: ${classError.message}`,
    };
  }
  if (!cls) {
    return { status: "failed", reason: "존재하지 않는 강좌입니다" };
  }
  if (cls.branch !== parsed.branch) {
    return {
      status: "failed",
      reason: "다른 분원의 강좌에 신청 페이지를 만들 수 없습니다",
    };
  }
  if (cls.subject !== "설명회") {
    return {
      status: "failed",
      reason: "설명회 강좌(subject='설명회')에만 신청 페이지를 만들 수 있습니다",
    };
  }

  // 기존 페이지 lookup → INSERT 또는 UPDATE 분기.
  const { data: existing, error: lookupError } = (await supabase
    .from("crm_class_signup_pages")
    .select("id")
    .eq("class_id", parsed.class_id)
    .maybeSingle()) as unknown as {
    data: { id: string } | null;
    error: { message: string } | null;
  };
  if (lookupError) {
    return {
      status: "failed",
      reason: `신청 페이지 조회에 실패했습니다: ${lookupError.message}`,
    };
  }

  const payload = {
    status: parsed.status,
    held_at: parsed.held_at,
    signup_opens_at: parsed.signup_opens_at,
    signup_closes_at: parsed.signup_closes_at,
    description: parsed.description,
    capacity_override: parsed.capacity_override,
  };

  if (existing) {
    const { error: updateError } = (await (
      supabase.from("crm_class_signup_pages") as unknown as {
        update: (v: Record<string, unknown>) => {
          eq: (
            col: string,
            val: string,
          ) => Promise<{ error: { message: string } | null }>;
        };
      }
    )
      .update(payload)
      .eq("id", existing.id)) as { error: { message: string } | null };
    if (updateError) {
      return {
        status: "failed",
        reason: `신청 페이지 갱신 실패: ${updateError.message}`,
      };
    }
    revalidatePath(`/classes/${parsed.class_id}`);
    return { status: "success", id: existing.id, created: false };
  }

  // 신규 생성. class_id + branch + created_by 추가.
  const { data: inserted, error: insertError } = (await (
    supabase.from("crm_class_signup_pages") as unknown as {
      insert: (v: Record<string, unknown>) => {
        select: (cols: string) => {
          single: () => Promise<{
            data: { id: string } | null;
            error: { message: string; code?: string } | null;
          }>;
        };
      };
    }
  )
    .insert({
      ...payload,
      class_id: parsed.class_id,
      branch: parsed.branch,
      created_by: auth.user.user_id,
    })
    .select("id")
    .single()) as {
    data: { id: string } | null;
    error: { message: string; code?: string } | null;
  };
  if (insertError || !inserted) {
    return {
      status: "failed",
      reason: `신청 페이지 생성 실패: ${insertError?.message ?? "알 수 없는 오류"}`,
    };
  }
  revalidatePath(`/classes/${parsed.class_id}`);
  return { status: "success", id: inserted.id, created: true };
}
