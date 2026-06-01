"use server";

/**
 * F5 · 설명회 Server Actions (0080).
 *
 * 액션 인벤토리:
 *   - createSeminarAction         : master/admin 만. link_token 자동 생성 + UNIQUE 재시도.
 *   - updateSeminarAction         : master/admin + 본인 분원. 분원 변경은 금지.
 *   - changeSeminarStatusAction   : status 수동 전이 (cancelled / open / closed / ended).
 *   - cancelSignupAction          : signup soft delete.
 *   - submitSignupAction          : anon 호출 가능. signup_for_seminar RPC 위임.
 *   - exportSignupsAction         : 신청자 명단 → xlsx (base64). master 만 raw 전화.
 *
 * 공통 정책 (group/actions.ts 미러):
 *   - dev-seed 모드는 모든 쓰기 액션이 `{ status: 'dev_seed_mode' }` 즉시 반환.
 *   - 인증: Supabase Auth `getCurrentUser`. submitSignupAction 은 익명 허용.
 *   - 권한: `can(user, 'write', 'group', branch)` 패턴 미러
 *     (Resource enum 에 'seminar' 가 아직 없어 'group' 으로 매핑 — 두 권한 모델 동일).
 *   - 입력 검증: Zod 스키마 재검증.
 *   - 성공 시 `revalidatePath('/seminars')` 또는 `/seminars/[id]`.
 */

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { ZodError } from "zod";
import * as XLSX from "xlsx";

import {
  CreateSeminarInputSchema,
  UpdateSeminarInputSchema,
  ChangeSeminarStatusInputSchema,
  CancelSignupInputSchema,
  SubmitSignupInputSchema,
  type CreateSeminarInput,
  type UpdateSeminarInput,
  type ChangeSeminarStatusInput,
  type CancelSignupInput,
  type SubmitSignupInput,
} from "@/lib/schemas/seminar";
import { generateLinkToken } from "@/lib/seminars/generate-link-token";
import { listSignups } from "@/lib/seminars/list-signups";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/can";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { formatPhone, maskPhone } from "@/lib/phone";
import { formatKstDateTime } from "@/lib/datetime";
import type {
  CurrentUser,
  SeminarRow,
  SignupForSeminarResult,
} from "@/types/database";

// ─── 결과 타입 ──────────────────────────────────────────────

export type CreateSeminarActionResult =
  | { status: "success"; id: string; link_token: string }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode"; id: string; link_token: string };

export type UpdateSeminarActionResult =
  | { status: "success" }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode" };

export type ChangeSeminarStatusActionResult =
  | { status: "success" }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode" };

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
export type SubmitSignupActionResult =
  | {
      status:
        | "signed"
        | "duplicate"
        | "closed"
        | "ended"
        | "cancelled"
        | "out_of_window"
        | "invalid";
      signupId: string | null;
      reason: string | null;
    }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode" };

/**
 * xlsx 다운로드 결과.
 *
 * 키명은 frontend (signups-table) 의 사용처와 1:1 — base64 / filename.
 * (atob(result.base64) → Blob → a.download = result.filename 패턴.)
 * mimeType 은 항상 xlsx 표준이라 클라이언트가 상수로 처리 — 응답 payload 에는 없음.
 */
export type ExportSignupsActionResult =
  | {
      status: "success";
      filename: string;
      /** Base64-encoded xlsx 바이너리. 클라이언트가 atob 후 Blob 로 다운로드. */
      base64: string;
      rowCount: number;
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

// ─── createSeminarAction ───────────────────────────────────

const TOKEN_RETRY_LIMIT = 3;

export async function createSeminarAction(
  input: CreateSeminarInput,
): Promise<CreateSeminarActionResult> {
  if (isDevSeedMode()) {
    // 시연용 가짜 토큰 — UI 가 "생성 성공" 메시지 띄울 수 있게 일관된 형태 반환.
    return {
      status: "dev_seed_mode",
      id: `dev-sem-${Date.now()}`,
      link_token: generateLinkToken(),
    };
  }

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

  // UNIQUE(link_token) 충돌 시 재시도. 12자 nanoid 라 사실상 0확률이지만 방어.
  let lastError: string | null = null;
  for (let attempt = 0; attempt < TOKEN_RETRY_LIMIT; attempt++) {
    const token = generateLinkToken();
    const insertPayload: Record<string, unknown> = {
      branch: parsed.branch,
      name: parsed.name,
      description: parsed.description,
      held_at: parsed.held_at,
      venue: parsed.venue,
      capacity: parsed.capacity,
      signup_opens_at: parsed.signup_opens_at,
      signup_closes_at: parsed.signup_closes_at,
      status: "open",
      link_token: token,
      created_by: auth.user.user_id,
    };

    const result = (await (
      supabase.from("crm_seminars") as unknown as {
        insert: (v: Record<string, unknown>) => {
          select: (cols: string) => {
            single: () => Promise<{
              data: { id: string; link_token: string } | null;
              error: { message: string; code?: string } | null;
            }>;
          };
        };
      }
    )
      .insert(insertPayload)
      .select("id, link_token")
      .single()) as {
      data: { id: string; link_token: string } | null;
      error: { message: string; code?: string } | null;
    };

    if (!result.error && result.data) {
      revalidatePath("/seminars");
      return {
        status: "success",
        id: result.data.id,
        link_token: result.data.link_token,
      };
    }

    // 23505 = UNIQUE 위반. 다른 에러면 즉시 실패.
    if (result.error?.code === "23505") {
      lastError = "토큰 충돌이 반복되어 생성에 실패했습니다";
      continue;
    }
    return {
      status: "failed",
      reason: `설명회 생성에 실패했습니다: ${result.error?.message ?? "알 수 없는 오류"}`,
    };
  }

  return {
    status: "failed",
    reason: lastError ?? "설명회 생성에 실패했습니다",
  };
}

// ─── updateSeminarAction ───────────────────────────────────

export async function updateSeminarAction(
  input: UpdateSeminarInput,
): Promise<UpdateSeminarActionResult> {
  if (isDevSeedMode()) return { status: "dev_seed_mode" };

  let parsed: UpdateSeminarInput;
  try {
    parsed = UpdateSeminarInputSchema.parse(input);
  } catch (e) {
    if (e instanceof ZodError) {
      return { status: "failed", reason: zodErrorToReason(e) };
    }
    return { status: "failed", reason: "입력 값이 올바르지 않습니다" };
  }

  const supabase = await createSupabaseServerClient();

  // 기존 행 로드 — 분원 격리 / 변경 가능 여부 확인.
  const { data: current, error: fetchError } = (await supabase
    .from("crm_seminars")
    .select("*")
    .eq("id", parsed.id)
    .maybeSingle()) as unknown as {
    data: SeminarRow | null;
    error: { message: string } | null;
  };
  if (fetchError) {
    return {
      status: "failed",
      reason: `설명회 조회에 실패했습니다: ${fetchError.message}`,
    };
  }
  if (!current) {
    return { status: "failed", reason: "존재하지 않는 설명회입니다" };
  }

  // 분원 기준 권한.
  const auth = await assertSeminarWrite(current.branch);
  if (!auth.ok) return { status: "failed", reason: auth.reason };

  // patch 구성. status 도 허용하지만 별도 changeSeminarStatusAction 권장.
  type SeminarPatch = {
    name?: string;
    description?: string | null;
    held_at?: string | null;
    venue?: string | null;
    capacity?: number | null;
    signup_opens_at?: string | null;
    signup_closes_at?: string | null;
    status?: SeminarRow["status"];
  };
  const patch: SeminarPatch = {};
  if (parsed.name !== undefined) patch.name = parsed.name;
  if (parsed.description !== undefined) patch.description = parsed.description;
  if (parsed.held_at !== undefined) patch.held_at = parsed.held_at;
  if (parsed.venue !== undefined) patch.venue = parsed.venue;
  if (parsed.capacity !== undefined) patch.capacity = parsed.capacity;
  if (parsed.signup_opens_at !== undefined) {
    patch.signup_opens_at = parsed.signup_opens_at;
  }
  if (parsed.signup_closes_at !== undefined) {
    patch.signup_closes_at = parsed.signup_closes_at;
  }
  if (parsed.status !== undefined) patch.status = parsed.status;

  if (Object.keys(patch).length === 0) {
    return { status: "success" };
  }

  const { error: updateError } = (await (
    supabase.from("crm_seminars") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (
          col: string,
          val: string,
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )
    .update(patch as unknown as Record<string, unknown>)
    .eq("id", parsed.id)) as {
    error: { message: string } | null;
  };

  if (updateError) {
    return {
      status: "failed",
      reason: `설명회 수정에 실패했습니다: ${updateError.message}`,
    };
  }

  revalidatePath("/seminars");
  revalidatePath(`/seminars/${parsed.id}`);
  return { status: "success" };
}

// ─── changeSeminarStatusAction ─────────────────────────────

export async function changeSeminarStatusAction(
  input: ChangeSeminarStatusInput,
): Promise<ChangeSeminarStatusActionResult> {
  if (isDevSeedMode()) return { status: "dev_seed_mode" };

  let parsed: ChangeSeminarStatusInput;
  try {
    parsed = ChangeSeminarStatusInputSchema.parse(input);
  } catch (e) {
    if (e instanceof ZodError) {
      return { status: "failed", reason: zodErrorToReason(e) };
    }
    return { status: "failed", reason: "입력 값이 올바르지 않습니다" };
  }

  const supabase = await createSupabaseServerClient();

  // 분원 격리: 기존 행 로드 → 본인 분원 확인.
  const { data: current, error: fetchError } = (await supabase
    .from("crm_seminars")
    .select("branch")
    .eq("id", parsed.seminar_id)
    .maybeSingle()) as unknown as {
    data: { branch: string } | null;
    error: { message: string } | null;
  };
  if (fetchError) {
    return {
      status: "failed",
      reason: `설명회 조회에 실패했습니다: ${fetchError.message}`,
    };
  }
  if (!current) {
    return { status: "failed", reason: "존재하지 않는 설명회입니다" };
  }

  const auth = await assertSeminarWrite(current.branch);
  if (!auth.ok) return { status: "failed", reason: auth.reason };

  const { error } = (await (
    supabase.from("crm_seminars") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (
          col: string,
          val: string,
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )
    .update({ status: parsed.status })
    .eq("id", parsed.seminar_id)) as {
    error: { message: string } | null;
  };

  if (error) {
    return {
      status: "failed",
      reason: `설명회 상태 변경에 실패했습니다: ${error.message}`,
    };
  }

  revalidatePath("/seminars");
  revalidatePath(`/seminars/${parsed.seminar_id}`);
  return { status: "success" };
}

// ─── cancelSignupAction ────────────────────────────────────

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

  // 신청 → 설명회 분원 lookup.
  const { data: signup, error: fetchError } = (await supabase
    .from("crm_seminar_signups")
    .select("id, seminar_id, status")
    .eq("id", parsed.signup_id)
    .maybeSingle()) as unknown as {
    data: { id: string; seminar_id: string; status: string } | null;
    error: { message: string } | null;
  };
  if (fetchError) {
    return {
      status: "failed",
      reason: `신청 조회에 실패했습니다: ${fetchError.message}`,
    };
  }
  if (!signup) {
    return { status: "failed", reason: "존재하지 않는 신청입니다" };
  }
  if (signup.status === "cancelled") {
    // 이미 취소 — idempotent 성공.
    return { status: "success" };
  }

  const { data: seminar, error: seminarError } = (await supabase
    .from("crm_seminars")
    .select("branch")
    .eq("id", signup.seminar_id)
    .maybeSingle()) as unknown as {
    data: { branch: string } | null;
    error: { message: string } | null;
  };
  if (seminarError) {
    return {
      status: "failed",
      reason: `설명회 조회에 실패했습니다: ${seminarError.message}`,
    };
  }
  if (!seminar) {
    return { status: "failed", reason: "설명회 정보가 없습니다" };
  }

  const auth = await assertSeminarWrite(seminar.branch);
  if (!auth.ok) return { status: "failed", reason: auth.reason };

  const { error: updateError } = (await (
    supabase.from("crm_seminar_signups") as unknown as {
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

  revalidatePath(`/seminars/${signup.seminar_id}`);
  return { status: "success" };
}

// ─── submitSignupAction (anon) ─────────────────────────────

/**
 * 학부모 신청 폼 제출 — anon 허용.
 *
 * 입력 정규화 / 비즈니스 검증(정원·창·중복)은 모두 `signup_for_seminar` RPC 내부에서
 * 수행. 이 액션은 wrapper 역할 + IP/UA 헤더 전달 + dev-seed 가짜 분기.
 *
 * 입력 객체는 SubmitSignupInputSchema + token 으로 구성. token 은 URL `/s/<token>` 의
 * link_token 이고 SubmitSignupInputSchema 외 별도 키.
 */
export async function submitSignupAction(
  input: SubmitSignupInput & { token: string },
): Promise<SubmitSignupActionResult> {
  if (isDevSeedMode()) return { status: "dev_seed_mode" };

  const rawToken = typeof input?.token === "string" ? input.token.trim() : "";
  if (rawToken.length === 0) {
    return { status: "failed", reason: "유효하지 않은 링크입니다" };
  }

  let parsed: SubmitSignupInput;
  try {
    parsed = SubmitSignupInputSchema.parse({
      student_name: input.student_name,
      parent_phone: input.parent_phone,
      consent: input.consent,
    });
  } catch (e) {
    if (e instanceof ZodError) {
      return { status: "failed", reason: zodErrorToReason(e) };
    }
    return { status: "failed", reason: "입력 값이 올바르지 않습니다" };
  }

  // 헤더에서 IP/UA 추출. proxy 환경 고려해 x-forwarded-for 우선.
  const hdrs = await headers();
  const xff = hdrs.get("x-forwarded-for");
  const clientIp =
    (xff ? xff.split(",")[0]?.trim() : null) ??
    hdrs.get("x-real-ip") ??
    null;
  const userAgent = hdrs.get("user-agent") ?? null;

  const supabase = await createSupabaseServerClient();
  // ⚠️ `.bind(supabase)` 필수 — 변수에 담아 호출하면 `this` 바인딩 깨져
  // 클라이언트 내부 `this.rest` 가 undefined 가 되어 TypeError. dev 우연 동작.
  const rpcFn = supabase.rpc.bind(supabase) as unknown as (
    fn: "signup_for_seminar",
    params: {
      p_token: string;
      p_student_name: string;
      p_parent_phone: string;
      p_client_ip: string | null;
      p_user_agent: string | null;
    },
  ) => Promise<{
    data: SignupForSeminarResult[] | null;
    error: { message: string } | null;
  }>;

  const rpcResult = await rpcFn("signup_for_seminar", {
    p_token: rawToken,
    p_student_name: parsed.student_name,
    p_parent_phone: parsed.parent_phone,
    p_client_ip: clientIp,
    p_user_agent: userAgent,
  });

  if (rpcResult.error) {
    return {
      status: "failed",
      reason: `신청 처리에 실패했습니다: ${rpcResult.error.message}`,
    };
  }
  const row = rpcResult.data && rpcResult.data.length > 0 ? rpcResult.data[0] : null;
  if (!row) {
    return { status: "failed", reason: "신청 결과를 받지 못했습니다" };
  }

  // RPC enum 을 그대로 펼친다 — 호출부 switch 가 단순.
  // 감사 로그 (학부모 번호는 마스킹). dev-seed/실패 경로 외 모두 로깅.
  console.log(
    `[seminars/signup] token=${rawToken.slice(0, 4)}**** phone=${maskPhone(parsed.parent_phone)} status=${row.status}`,
  );

  return {
    status: row.status,
    signupId: row.signup_id,
    reason: row.reason,
  };
}

// ─── exportSignupsAction ──────────────────────────────────

/**
 * 신청자 명단 xlsx export.
 *
 * 권한:
 *   - master/admin 본인 분원만.
 *   - master 는 학부모 전화 raw, admin 은 마스킹(010-****-XXXX).
 *
 * 반환:
 *   - base64 인코딩된 xlsx 바이너리. 프론트가 atob → Uint8Array → Blob 으로 다운로드.
 *   - 액션→클라이언트 직렬화는 ArrayBuffer 미지원 — base64 가 최소 손실.
 *
 * 감사:
 *   - 로그에 user_id + seminar_id + row_count 만. 학부모 번호는 마스킹.
 *   - Phase 1 은 console.log 로 충분. Phase 2 에 별도 audit 테이블.
 */
export async function exportSignupsAction(
  seminarId: string,
): Promise<ExportSignupsActionResult> {
  if (isDevSeedMode()) return { status: "dev_seed_mode" };

  if (typeof seminarId !== "string" || seminarId.length === 0) {
    return { status: "failed", reason: "설명회 ID 가 유효하지 않습니다" };
  }

  const supabase = await createSupabaseServerClient();

  // 설명회 → 분원 + 이름 (파일명용).
  const { data: seminar, error: seminarError } = (await supabase
    .from("crm_seminars")
    .select("id, branch, name")
    .eq("id", seminarId)
    .maybeSingle()) as unknown as {
    data: { id: string; branch: string; name: string } | null;
    error: { message: string } | null;
  };
  if (seminarError) {
    return {
      status: "failed",
      reason: `설명회 조회에 실패했습니다: ${seminarError.message}`,
    };
  }
  if (!seminar) {
    return { status: "failed", reason: "존재하지 않는 설명회입니다" };
  }

  const auth = await assertSeminarWrite(seminar.branch);
  if (!auth.ok) return { status: "failed", reason: auth.reason };

  // 전체 명단 — listSignups 는 페이지네이션 없이 전체 반환.
  // signed + cancelled 모두 포함 (운영자 백오피스 용).
  const allRows = await listSignups(seminarId);

  const isMaster = auth.user.role === "master";

  const sheetRows = allRows.map((r) => ({
    "학생 이름": r.student_name,
    "학부모 연락처": isMaster
      ? formatPhone(r.parent_phone)
      : maskPhone(r.parent_phone),
    상태: r.status === "signed" ? "신청" : "취소",
    "신청 일시": formatKstDateTime(r.created_at),
    "취소 일시":
      r.cancelled_at !== null ? formatKstDateTime(r.cancelled_at) : "",
  }));

  const worksheet = XLSX.utils.json_to_sheet(sheetRows);
  // 컬럼 폭 (가독성).
  worksheet["!cols"] = [
    { wch: 14 }, // 학생 이름
    { wch: 18 }, // 학부모 연락처
    { wch: 8 }, // 상태
    { wch: 20 }, // 신청
    { wch: 20 }, // 취소
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "신청자");

  const buffer = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "buffer",
  }) as Buffer;
  const base64 = buffer.toString("base64");

  // 파일명: "설명회명_YYYYMMDD.xlsx" — slugify 간단화.
  const safeName = seminar.name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `${safeName}_${stamp}.xlsx`;

  // 감사 로그 (Phase 1).
  console.log(
    `[seminars/export] user=${auth.user.user_id} seminar=${seminarId} rows=${allRows.length} masked=${!isMaster}`,
  );

  return {
    status: "success",
    filename,
    base64,
    rowCount: allRows.length,
  };
}
