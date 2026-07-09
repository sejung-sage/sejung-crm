"use server";

/**
 * F1 · 학생 직접 등록 Server Action
 *
 * Aca2000 이관 학생과 별개로 우리 CRM 에서 직접 만드는 학생용.
 * 자체 등록 행은 students.aca2000_id 를 `MANUAL-<timestamp>` 로 채워
 * Aca2000 이관 행 (숫자형 또는 `<branch_id>-<학생_코드>`) 과 구분.
 *
 * 정책:
 *   - dev-seed 모드: 즉시 dev_seed_mode 반환 (쓰기 차단)
 *   - 인증: Supabase Auth + users_profile.role ∈ { master, admin }
 *   - 입력 검증: CreateStudentInputSchema 재검증
 *   - 성공 시 revalidatePath("/students")
 */

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import {
  CreateStudentInputSchema,
  type CreateStudentInput,
} from "@/lib/schemas/student";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type CreateStudentActionResult =
  | { status: "success"; id: string }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode" };

const WRITE_ROLES = new Set<string>(["master", "admin"]);

type AuthOk = { ok: true; userId: string };
type AuthFail = { ok: false; reason: string };

async function assertWriteRole(): Promise<AuthOk | AuthFail> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { ok: false, reason: "로그인 후 이용 가능합니다" };
  }

  const { data, error } = await supabase
    .from("crm_users_profile")
    .select("role, active")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    return { ok: false, reason: "권한 확인에 실패했습니다" };
  }
  if (!data) {
    return { ok: false, reason: "계정 프로필이 없습니다" };
  }
  // Supabase v2 Database 타입 추론 한계 — 좁은 캐스팅 (groups/actions.ts 동일 패턴)
  const profile = data as { role?: string; active?: boolean };
  if (!profile.active) {
    return { ok: false, reason: "비활성 계정입니다" };
  }
  if (!profile.role || !WRITE_ROLES.has(profile.role)) {
    return { ok: false, reason: "학생 등록 권한이 없습니다 (master/admin 만)" };
  }

  return { ok: true, userId: user.id };
}

/**
 * 학생 직접 등록.
 * aca2000_id 는 Server Action 에서 `MANUAL-<timestamp>-<userIdSuffix>` 자동 생성.
 * UNIQUE 충돌 가능성은 사실상 없음 (timestamp ms + 사용자 4자리).
 */
export async function createStudentAction(
  input: CreateStudentInput,
): Promise<CreateStudentActionResult> {
  if (isDevSeedMode()) {
    return { status: "dev_seed_mode" };
  }

  const auth = await assertWriteRole();
  if (!auth.ok) {
    return { status: "failed", reason: auth.reason };
  }

  let parsed: CreateStudentInput;
  try {
    parsed = CreateStudentInputSchema.parse(input);
  } catch (e) {
    if (e instanceof ZodError) {
      const first = e.issues[0];
      return {
        status: "failed",
        reason: first?.message ?? "입력값이 올바르지 않습니다",
      };
    }
    return { status: "failed", reason: "입력값 검증에 실패했습니다" };
  }

  // ETL(normalize_phone)과 동일하게 숫자만 저장한다. 하이픈이 섞여 들어가면 번호
  // 등가 비교가 조용히 어긋난다 — 실제로 수동 등록 4건의 하이픈 표기 때문에 수신거부
  // 제외가 무력화됐다(0107 로 SQL 비교도 정규화, 0108 로 기존 행 정리).
  const parentPhone = parsed.parent_phone.replace(/\D/g, "");
  if (parentPhone.length === 0) {
    // parent_phone 은 NOT NULL. 숫자가 없으면 DB 에러 대신 검증 실패로 끝낸다.
    return { status: "failed", reason: "학부모 연락처를 확인해 주세요" };
  }

  // 자체 등록 키. timestamp + 사용자 ID 끝 4자리로 충돌 방지.
  const aca2000_id = `MANUAL-${Date.now()}-${auth.userId.slice(-4)}`;

  const supabase = await createSupabaseServerClient();
  const today = new Date()
    .toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" })
    .slice(0, 10);

  // Supabase v2 Database 타입 추론 한계 (groups/actions.ts 동일 패턴) — 좁은 캐스팅.
  const insertPayload: Record<string, unknown> = {
    aca2000_id,
    name: parsed.name,
    parent_phone: parentPhone,
    phone: null,
    school: parsed.school || null,
    grade: parsed.grade ?? null,
    grade_raw: parsed.grade ?? null,
    school_level: null,
    status: parsed.status,
    branch: parsed.branch,
    registered_at: today,
  };

  const { data, error } = await (
    supabase.from("crm_students") as unknown as {
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
    .insert(insertPayload)
    .select("id")
    .single();

  if (error) {
    return {
      status: "failed",
      reason: `학생 등록에 실패했습니다: ${error.message}`,
    };
  }
  if (!data) {
    return { status: "failed", reason: "생성된 학생 ID 를 읽지 못했습니다" };
  }

  revalidatePath("/students");
  return { status: "success", id: data.id };
}

// ─── 수신거부(opt-out) 등록 / 해제 ────────────────────────────
//
// crm_unsubscribes(phone TEXT PK, unsubscribed_at, reason) 사용.
// RLS: 읽기 전체 · INSERT 누구나 · DELETE master 전용.
//   - 등록(add)은 RLS 상 viewer 도 가능하나 게이팅은 UI 책임.
//   - 해제(remove)는 master 전용 — 서버에서도 역할 재확인.

/** 휴대폰/유선 최소 자릿수 (지역번호 02 + 국번 + 가입자 = 최소 9). */
const MIN_PHONE_DIGITS = 9;
/** PostgreSQL unique_violation 코드. 멱등 등록 판정용. */
const PG_UNIQUE_VIOLATION = "23505";

/** 하이픈 등 비숫자 제거. 빈 결과는 null. */
function normalizeUnsubPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

export async function addUnsubscribeAction(input: {
  phone: string;
  reason?: string | null;
}): Promise<{
  status: "success" | "failed" | "dev_seed_mode";
  reason?: string;
}> {
  if (isDevSeedMode()) {
    return { status: "dev_seed_mode" };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { status: "failed", reason: "로그인 후 이용 가능합니다" };
  }

  const phone = normalizeUnsubPhone(input.phone);
  if (!phone || phone.length < MIN_PHONE_DIGITS) {
    return { status: "failed", reason: "올바른 전화번호를 입력해 주세요" };
  }

  const supabase = await createSupabaseServerClient();
  // Supabase v2 Database 타입 추론 한계 — 좁은 캐스팅 (위 createStudentAction 동일 패턴).
  const { error } = await (
    supabase.from("crm_unsubscribes") as unknown as {
      insert: (v: Record<string, unknown>) => Promise<{
        error: { message: string; code?: string } | null;
      }>;
    }
  ).insert({
    phone,
    reason: input.reason ?? "운영자 등록",
  });

  if (error) {
    // 멱등 — 이미 수신거부된 번호(PK 충돌)는 성공으로 처리.
    if (error.code === PG_UNIQUE_VIOLATION) {
      revalidatePath("/students", "layout");
      return { status: "success" };
    }
    return {
      status: "failed",
      reason: `수신거부 등록에 실패했습니다: ${error.message}`,
    };
  }

  revalidatePath("/students", "layout");
  return { status: "success" };
}

export async function removeUnsubscribeAction(input: {
  phone: string;
}): Promise<{
  status: "success" | "failed" | "forbidden" | "dev_seed_mode";
  reason?: string;
}> {
  if (isDevSeedMode()) {
    return { status: "dev_seed_mode" };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { status: "failed", reason: "로그인 후 이용 가능합니다" };
  }
  // master 전용 — RLS 1차 + 서버에서 역할 재확인.
  if (user.role !== "master") {
    return {
      status: "forbidden",
      reason: "수신거부 해제는 master 만 가능합니다",
    };
  }

  const phone = normalizeUnsubPhone(input.phone);
  if (!phone || phone.length < MIN_PHONE_DIGITS) {
    return { status: "failed", reason: "올바른 전화번호를 입력해 주세요" };
  }

  const supabase = await createSupabaseServerClient();
  // 저장이 하이픈 포함일 수도 있으니 정규화/원본 둘 다로 안전 삭제.
  const targets =
    input.phone && input.phone !== phone ? [phone, input.phone] : [phone];

  // Supabase v2 Database 타입 추론 한계 — 좁은 캐스팅.
  const { error } = await (
    supabase.from("crm_unsubscribes") as unknown as {
      delete: () => {
        in: (
          col: string,
          vals: string[],
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )
    .delete()
    .in("phone", targets);

  if (error) {
    return {
      status: "failed",
      reason: `수신거부 해제에 실패했습니다: ${error.message}`,
    };
  }

  revalidatePath("/students", "layout");
  return { status: "success" };
}
