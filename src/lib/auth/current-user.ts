/**
 * F4 · 현재 로그인 사용자 조회 헬퍼
 *
 * Server Component / Server Action / Route Handler 공통 진입점.
 *
 * 정책:
 *  - dev-seed 모드면 실제 Supabase 세션을 건너뛰고 `DEV_VIRTUAL_MASTER` 반환.
 *    (로컬 시연·개발 시 자동 로그인 시뮬레이션)
 *  - 일반 모드에서는 Supabase `auth.getUser()` → `users_profile` 조회를 수행.
 *    둘 중 하나라도 없거나, `active=false` 이면 **null** 반환(로그아웃 효과).
 *  - 개인정보 보호: 로그를 남기지 않는다(사용자 id/email 등).
 *
 * 주의:
 *  - middleware 에서도 동일한 정책을 재구현(그쪽은 edge runtime 제약).
 *    즉 이 함수는 "서버 컴포넌트에서 CurrentUser 를 즉시 얻고 싶을 때" 사용하는
 *    편의 함수이고, 보안 게이트는 middleware + Server Action 양쪽에서 이중으로 수행.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  DEV_VIRTUAL_MASTER,
  isDevSeedMode,
} from "@/lib/profile/students-dev-seed";
import type { CurrentUser, UserProfileRow } from "@/types/database";

export async function getCurrentUser(): Promise<CurrentUser | null> {
  // 1) dev-seed 모드 → 가상 master 즉시 반환
  if (isDevSeedMode()) {
    return DEV_VIRTUAL_MASTER;
  }

  // 2) Supabase 세션 사용자
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return null;
  }

  // 3) users_profile 조회
  const { data, error } = await supabase
    .from("users_profile")
    .select(
      "user_id, name, email, role, branch, active, must_change_password",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const profile = data as Pick<
    UserProfileRow,
    | "user_id"
    | "name"
    | "email"
    | "role"
    | "branch"
    | "active"
    | "must_change_password"
  >;

  // 4) 비활성 계정 → 로그아웃 효과
  if (!profile.active) {
    return null;
  }

  // 5) email 은 CurrentUser 에서 non-null. auth.users.email 이 있다면
  //    그걸 우선 신뢰(프로필 email 이 sync 지연된 경우 대비).
  const email = user.email ?? profile.email ?? "";
  if (!email) {
    return null;
  }

  return {
    user_id: profile.user_id,
    email,
    name: profile.name,
    role: profile.role,
    branch: profile.branch,
    active: profile.active,
    must_change_password: profile.must_change_password,
  };
}
