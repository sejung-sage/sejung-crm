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
import { ZodError } from "zod";
import { loadAllGroupRecipients } from "@/lib/groups/load-all-group-recipients";
import { getGroup } from "@/lib/groups/get-group";

import {
  CancelSignupInputSchema,
  CreateBroadcastInputSchema,
  ClaimInvitationItemInputSchema,
  UpsertClassSignupPageInputSchema,
  type CancelSignupInput,
  type CreateBroadcastInput,
  type ClaimInvitationItemInput,
  type UpsertClassSignupPageInput,
} from "@/lib/schemas/seminar";
import { generateLinkToken } from "@/lib/seminars/generate-link-token";
import {
  dispatchBroadcast,
  type BroadcastRecipient,
} from "@/lib/seminars/dispatch-broadcast";
import { getUnsubscribedPhones } from "@/lib/messaging/unsubscribed-phones";
import { applyNameToken } from "@/lib/messaging/personalize";
import { countEucKrBytes } from "@/lib/messaging/sms-bytes";
import { BYTE_LIMITS } from "@/lib/schemas/template";
import {
  insertAdTag,
  insertUnsubscribeFooter,
  checkQuietHours,
} from "@/lib/messaging/guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
      invitation_count: number;
      sent: number;
      failed: number;
      total_cost: number;
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

/** 본문에 학생별 URL 을 박을 변수 토큰 (운영자 시각). */
const INVITE_TOKEN = "{초대링크}";
/** sendon SDK 가 인식하는 치환 src — Receiver.name 슬롯에 매핑됨. */
const SENDON_INVITE_PLACEHOLDER = "#{이름}";
/** 1회 발송 상한 — send-campaign 과 동일 정책. */
const MAX_INVITATION_RECIPIENTS = 10_000;
/** invitation.link_token UNIQUE 충돌 시 재시도 한도. */
const INVITATION_TOKEN_RETRY = 3;

export async function createSeminarBroadcastAction(
  input: CreateBroadcastInput,
): Promise<CreateSeminarBroadcastActionResult> {
  // dev-seed: 가짜 결과로 UI 흐름만 확인 — 실 발송·DB 쓰기 X.
  // (group_id 만 받으니 실제 학생 수는 알 수 없음 — placeholder 1)
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

  // 2-2) 각 강좌의 crm_class_signup_pages find-or-create.
  //      페이지 1:1 강좌 (UNIQUE class_id). 없으면 자동 생성.
  const { data: existingPages, error: pageFetchError } = (await supabase
    .from("crm_class_signup_pages")
    .select("id, class_id")
    .in("class_id", parsed.class_ids)) as unknown as {
    data: Array<{ id: string; class_id: string }> | null;
    error: { message: string } | null;
  };
  if (pageFetchError) {
    return {
      status: "failed",
      reason: `신청 페이지 조회에 실패했습니다: ${pageFetchError.message}`,
    };
  }
  const pageByClass = new Map<string, string>();
  for (const p of existingPages ?? []) pageByClass.set(p.class_id, p.id);

  const toCreatePages = parsed.class_ids.filter(
    (cid) => !pageByClass.has(cid),
  );
  if (toCreatePages.length > 0) {
    const newPageRows = toCreatePages.map((cid) => ({
      class_id: cid,
      branch: parsed.branch,
      status: "open",
      created_by: auth.user.user_id,
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
        status: "failed",
        reason: `신청 페이지 생성 실패: ${createPageError?.message ?? "알 수 없는 오류"}`,
      };
    }
    for (const p of createdPages) pageByClass.set(p.class_id, p.id);
  }

  // class_ids 순서대로 signup_page_ids 배열 추출 (items INSERT 에 사용).
  const signupPageIds = parsed.class_ids.map((cid) => {
    const pid = pageByClass.get(cid);
    if (!pid) {
      // 위 find-or-create 이후 누락은 사실상 발생 X — 방어.
      throw new Error(`signup_page 매핑 누락: class_id=${cid}`);
    }
    return pid;
  });

  // 3) 그룹 권한·분원 격리 검증.
  const group = await getGroup(parsed.group_id);
  if (!group) {
    return { status: "failed", reason: "발송 그룹을 찾을 수 없습니다" };
  }
  if (group.branch !== parsed.branch) {
    return {
      status: "failed",
      reason: "다른 분원의 발송 그룹은 사용할 수 없습니다",
    };
  }

  // 4) 그룹 → 학생 펼침. 수신거부·탈퇴·branch 격리는 `loadAllGroupRecipients`
  //    가 SQL 단에서 모두 처리 (청크/페이지네이션 내장 — URL 한도 안전).
  //    client→server 로 student_ids 를 왕복 전달하지 않아 Cloudflare 414 회피.
  const recipients = await loadAllGroupRecipients(
    supabase,
    parsed.group_id,
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
  const students: StudentRow[] = recipients.map((r) => ({
    id: r.id,
    name: r.name,
    parent_phone: r.parent_phone,
    branch: parsed.branch, // 그룹 branch 일치 보장됨(위 가드)
    status: r.status,
  }));

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

  // 5) 광고 야간 차단 (정보성이면 무관, allowed=true).
  //    여기서 즉시 차단하면 학생/캠페인 INSERT 비용 자체를 절약.
  const quiet = checkQuietHours(new Date(), parsed.is_ad);
  if (!quiet.allowed) {
    return {
      status: "blocked",
      reason:
        "야간 광고 차단 시간대입니다 (21:00~08:00). 다른 시간에 발송해 주세요.",
    };
  }

  // 6) 본문 + 학생별 URL placeholder 변환 + 광고 가드 가공.
  //    순서:
  //      a. {초대링크} → #{이름} (sendon Replace 슬롯) — 없으면 본문 끝에 자동 부착
  //      b. is_ad=true 면 (광고) prefix 부착 (이미 있으면 스킵)
  //      c. is_ad=true 면 \n무료수신거부 080-XXXX footer 부착 (이미 있으면 스킵)
  //      d. {이름} 토큰 잔존 검사 (본 발송 미지원 — name 슬롯을 URL 로 점유)
  //      e. URL 최장 합성 후 EUC-KR 바이트 한도 검증
  //
  //    가드 헬퍼(`insertAdTag` / `insertUnsubscribeFooter`)는 isAd=false 면 원문
  //    그대로 반환 → 정보성에선 종전 동작과 동일.
  const trimmed = parsed.body.trim();
  let finalBody = trimmed.includes(INVITE_TOKEN)
    ? trimmed.split(INVITE_TOKEN).join(SENDON_INVITE_PLACEHOLDER)
    : `${trimmed}\n\n신청: ${SENDON_INVITE_PLACEHOLDER}`;

  // 광고 prefix / footer (헬퍼가 isAd=false 면 no-op).
  finalBody = insertAdTag(finalBody, parsed.is_ad);
  // optout 우선순위: 입력 > env (`SMS_OPT_OUT_NUMBER`) > 헬퍼 기본값.
  //   parsed.optout_phone 는 null 일 수 있어 undefined 로 정규화 (헬퍼가 env 폴백).
  finalBody = insertUnsubscribeFooter(
    finalBody,
    parsed.is_ad,
    parsed.optout_phone ?? undefined,
  );

  // {이름} 토큰이 본문에 남아 있으면 본 발송이 처리 불가 — 운영자에게 안내.
  if (finalBody.includes("{이름}")) {
    return {
      status: "blocked",
      reason: "설명회 발송에서는 {이름} 변수를 사용할 수 없습니다 ({초대링크} 만 지원)",
    };
  }

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
    scheduled_at: null,
    sent_at: new Date().toISOString(),
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

  // 7) 학생당 invitation + items INSERT. 토큰 UNIQUE 충돌 시 재시도(최대 3회).
  const invitationByStudent = new Map<string, { id: string; token: string }>();
  for (const s of filtered) {
    let inserted: { id: string; token: string } | null = null;
    let lastError: string | null = null;
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
          branch: parsed.branch,
          student_id: s.id,
          link_token: token,
          campaign_id: campaignId,
          created_by: auth.user.user_id,
        })
        .select("id")
        .single()) as {
        data: { id: string } | null;
        error: { message: string; code?: string } | null;
      };
      if (!invError && invRow) {
        inserted = { id: invRow.id, token };
        break;
      }
      // 23505 = UNIQUE 위반 — 토큰 재시도.
      if (invError?.code === "23505") {
        lastError = "토큰 충돌";
        continue;
      }
      lastError = invError?.message ?? "알 수 없는 오류";
      break;
    }
    if (!inserted) {
      // 토큰 재시도 모두 실패 또는 다른 에러 → 캠페인 실패 처리 후 종료.
      await safeMarkCampaignFailed(supabase, campaignId);
      return {
        status: "failed",
        reason: `invitation 생성 실패: ${lastError ?? "알 수 없는 오류"}`,
      };
    }
    invitationByStudent.set(s.id, inserted);
  }

  // 7-2) invitation_items 일괄 INSERT (학생 × signup_page 매트릭스).
  //      0084: seminar_id 컬럼 → signup_page_id. 페이지는 위 2-2 에서 확보.
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
  const { error: itemsError } = (await (
    supabase.from("crm_class_signup_items") as unknown as {
      insert: (v: Record<string, unknown>[]) => Promise<{
        error: { message: string } | null;
      }>;
    }
  ).insert(itemRows)) as { error: { message: string } | null };
  if (itemsError) {
    await safeMarkCampaignFailed(supabase, campaignId);
    return {
      status: "failed",
      reason: `invitation 카드 생성 실패: ${itemsError.message}`,
    };
  }

  // 8) sendon batch 발송.
  const fromNumber = process.env.SENDON_FROM_NUMBER;
  if (!fromNumber || fromNumber.length === 0) {
    await safeMarkCampaignFailed(supabase, campaignId);
    return {
      status: "failed",
      reason: "SENDON_FROM_NUMBER 환경변수가 설정되지 않았습니다",
    };
  }
  const broadcastRecipients: BroadcastRecipient[] = filtered.map((s) => {
    const inv = invitationByStudent.get(s.id);
    // 위 루프에서 모든 학생에 inv 가 있음을 보장 — 방어로 빈 토큰 fallback.
    return {
      invitation_id: inv?.id ?? "",
      student_id: s.id,
      student_name: applyNameToken("{이름}", s.name), // '학부모님' fallback 포함.
      parent_phone: s.parent_phone,
      link_token: inv?.token ?? "",
    };
  });

  const dispatchResult = await dispatchBroadcast(supabase, {
    campaignId,
    recipients: broadcastRecipients,
    body: finalBody,
    subject: parsed.subject,
    type: parsed.type,
    fromNumber,
  });

  // 9) campaign 최종 상태 + 비용 UPDATE.
  const finalStatus = dispatchResult.sent > 0 ? "완료" : "실패";
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
    .update({
      status: finalStatus,
      total_cost: Math.round(dispatchResult.totalCost),
    })
    .eq("id", campaignId);

  revalidatePath("/seminars/compose");
  revalidatePath("/campaigns");

  if (dispatchResult.sent === 0) {
    return {
      status: "failed",
      reason: dispatchResult.failedReason ?? "발송에 실패했습니다",
    };
  }

  return {
    status: "success",
    campaign_id: campaignId,
    invitation_count: filtered.length,
    sent: dispatchResult.sent,
    failed: dispatchResult.failed,
    total_cost: Math.round(dispatchResult.totalCost),
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
