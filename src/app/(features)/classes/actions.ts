"use server";

/**
 * F0 · 강좌 Server Actions.
 *
 * 현재는 시즌(season) 변경 1건만 노출 (0070 마이그).
 * 운영팀이 강좌 리스트에서 dropdown 으로 season 을 선택하면 호출되며,
 * 다음 ETL(apply_aca_to_crm) 재실행 시에도 COALESCE 룰로 보존된다.
 *
 * 권한 정책:
 *   - master    : 모든 분원
 *   - admin     : 본인 분원 한정 (DB 의 RLS crm_classes_write_by_branch 와 동일)
 *   - 그 외     : 차단 (manager / viewer 는 시즌 수정 불가)
 *
 * dev-seed 모드:
 *   - 강좌 시드가 비어 있어 의미 있는 갱신이 없다.
 *   - 즉시 `dev_seed_mode` 반환해 UI 가 "개발 모드 안내" toast 를 띄울 수 있게.
 *
 * 1차 가드 (역할/분원/입력 검증) → 2차 가드 (RLS) 의 표준 패턴.
 * UI 노출은 보안 신뢰 X — 액션 자체에서 재검증.
 */

import { revalidatePath } from "next/cache";
import { ZodError, z } from "zod";

import { SeasonSchema } from "@/lib/schemas/common";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// ─── 결과 타입 ──────────────────────────────────────────────

export type UpdateClassSeasonActionResult =
  | { status: "success" }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode" };

// ─── 입력 스키마 ────────────────────────────────────────────

/**
 * 시즌 변경 입력.
 *  - id     : crm_classes.id (uuid)
 *  - season : 6종 enum 또는 null (미분류로 되돌림)
 */
const UpdateClassSeasonInputSchema = z.object({
  id: z.string().uuid({ message: "강좌 ID 가 올바르지 않습니다" }),
  season: SeasonSchema.nullable(),
});

export type UpdateClassSeasonInput = z.infer<
  typeof UpdateClassSeasonInputSchema
>;

// ─── 권한 가드 ─────────────────────────────────────────────
//
// templates / regions 의 assertWriteRole 패턴과 동일.
// 차이: 시즌 변경은 분원 교차 검증이 필요해 호출부에서 대상 강좌의 branch 와
// 비교하므로 여기서는 role+branch+active 만 묶어 반환.

const WRITE_ROLES = new Set<string>(["master", "admin"]);

type AuthOk = { ok: true; userId: string; role: string; branch: string };
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
    .select("role, active, branch")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    return { ok: false, reason: "권한 정보 조회에 실패했습니다" };
  }
  if (!data) {
    return { ok: false, reason: "계정 프로필이 없습니다" };
  }
  const profile = data as {
    role?: string;
    active?: boolean;
    branch?: string;
  };
  if (!profile.active) {
    return { ok: false, reason: "비활성 계정은 사용할 수 없습니다" };
  }
  if (!profile.role || !WRITE_ROLES.has(profile.role)) {
    return { ok: false, reason: "강좌 수정 권한이 없습니다 (master/admin)" };
  }
  if (!profile.branch) {
    return { ok: false, reason: "계정 분원 정보가 없습니다" };
  }
  return {
    ok: true,
    userId: user.id,
    role: profile.role,
    branch: profile.branch,
  };
}

function zodErrorToReason(err: ZodError): string {
  const first = err.issues[0];
  if (!first) return "입력 값이 올바르지 않습니다";
  return first.message || "입력 값이 올바르지 않습니다";
}

// ─── updateClassSeasonAction ─────────────────────────────────

/**
 * 강좌 1건의 시즌(season) 변경.
 *
 * 단계:
 *   1) dev-seed 가드
 *   2) 입력 Zod 검증 (id uuid + season enum 또는 null)
 *   3) 권한 가드 (master/admin)
 *   4) 대상 강좌 branch 조회 → admin 이면 본인 분원과 일치 확인
 *   5) UPDATE crm_classes SET season = ?
 *   6) revalidatePath('/classes')
 *
 * 분원 교차 검증은 1차 방어 — RLS 의 crm_classes_write_by_branch 가 2차로
 * 막아주지만, 명시적 가드로 사용자에게 더 정확한 거부 사유를 돌려준다.
 */
export async function updateClassSeasonAction(
  input: UpdateClassSeasonInput,
): Promise<UpdateClassSeasonActionResult> {
  if (isDevSeedMode()) {
    return { status: "dev_seed_mode" };
  }

  let parsed: UpdateClassSeasonInput;
  try {
    parsed = UpdateClassSeasonInputSchema.parse(input);
  } catch (e) {
    if (e instanceof ZodError) {
      return { status: "failed", reason: zodErrorToReason(e) };
    }
    return { status: "failed", reason: "입력 값이 올바르지 않습니다" };
  }

  const auth = await assertWriteRole();
  if (!auth.ok) {
    return { status: "failed", reason: auth.reason };
  }

  const supabase = await createSupabaseServerClient();

  // 분원 교차 검증 — admin 은 본인 분원 강좌만.
  // RLS 가 SELECT 도 분원 기준으로 막으므로, 다른 분원 강좌 id 를 직접 던지면
  // 여기 SELECT 단계에서 not-found 가 된다. 그래도 명시적 분원 검사를 한 번 더
  // 둬 master 가 우회 가능한 점·실패 사유를 분명히 한다.
  const { data: classRow, error: selectError } = await supabase
    .from("crm_classes")
    .select("branch")
    .eq("id", parsed.id)
    .maybeSingle();

  if (selectError) {
    return {
      status: "failed",
      reason: `강좌 조회에 실패했습니다: ${selectError.message}`,
    };
  }
  if (!classRow) {
    return { status: "failed", reason: "강좌를 찾을 수 없습니다" };
  }

  const targetBranch = (classRow as { branch?: string }).branch;
  if (!targetBranch) {
    // 정상 데이터에선 발생하지 않으나 방어적으로.
    return { status: "failed", reason: "강좌의 분원 정보를 확인할 수 없습니다" };
  }
  if (auth.role !== "master" && targetBranch !== auth.branch) {
    return {
      status: "failed",
      reason: "본인 분원 강좌만 수정할 수 있습니다",
    };
  }

  // UPDATE — Supabase v2 Database 타입 추론 한계 회피 패턴 (templates/actions
  // 와 동일 톤). season 은 enum 또는 null.
  const { error: updateError } = await (
    supabase.from("crm_classes") as unknown as {
      update: (v: Record<string, unknown>) => {
        eq: (
          col: string,
          val: string,
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )
    .update({ season: parsed.season })
    .eq("id", parsed.id);

  if (updateError) {
    return {
      status: "failed",
      reason: `강좌 시즌 변경에 실패했습니다: ${updateError.message}`,
    };
  }

  // 강좌 리스트 + 상세 페이지 캐시 무효화.
  revalidatePath("/classes");
  revalidatePath(`/classes/${parsed.id}`);
  return { status: "success" };
}
