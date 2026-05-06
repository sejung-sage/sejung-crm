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
    .from("users_profile")
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
    parent_phone: parsed.parent_phone,
    phone: null,
    school: parsed.school || null,
    grade: parsed.grade ?? null,
    grade_raw: parsed.grade ?? null,
    school_level: null,
    track: null,
    status: parsed.status,
    branch: parsed.branch,
    registered_at: today,
  };

  const { data, error } = await (
    supabase.from("students") as unknown as {
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
