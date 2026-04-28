import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import type { UserRole } from "@/types/database";
import { ImportPageClient } from "@/components/admin/import-page-client";

/**
 * F1-03 · Aca2000 CSV/XLSX Import 페이지 (/admin/import)
 *
 * Server Component. 상단에서 현재 로그인 사용자 role 을 검증하여
 * master / admin 만 접근 가능. manager / viewer 는 차단.
 *
 * 로컬 개발 편의를 위해 dev-seed 모드 (NEXT_PUBLIC_SUPABASE_URL 미설정)
 * 에서는 권한 게이트를 통과시켜 UI 확인이 가능하도록 한다.
 * 실제 commit 은 backend 에서 `dev_seed_mode` 로 차단된다.
 */
export default async function ImportPage() {
  const allowed = await isAllowed();

  return (
    <div className="max-w-6xl space-y-6">
      <header>
        <h1 className="text-[20px] font-semibold text-[color:var(--text)]">
          엑셀 가져오기
        </h1>
        <p className="mt-1 text-[15px] text-[color:var(--text-muted)]">
          Aca2000 에서 내보낸 학생·수강·출석 엑셀을 업로드하세요. 먼저 미리보기
          후 확정합니다.
        </p>
      </header>

      {allowed ? (
        <ImportPageClient />
      ) : (
        <div
          role="alert"
          className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-muted)] p-6"
        >
          <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
            권한이 없습니다
          </h2>
          <p className="mt-2 text-[14px] text-[color:var(--text-muted)]">
            데이터 가져오기 기능은 원장(master) 또는 관리자(admin) 계정에서만
            사용할 수 있습니다. 권한이 필요하면 원장에게 문의하세요.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * 현재 사용자가 import 기능에 접근 가능한지 확인.
 * - dev-seed 모드: 무조건 통과 (로컬 UI 확인용)
 * - supabase 연결 시: users_profile.role 이 master/admin 인지 확인
 * - 조회 실패나 로그인 미검증 시: 차단
 */
async function isAllowed(): Promise<boolean> {
  if (isDevSeedMode()) return true;

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return false;

    const { data, error } = await supabase
      .from("users_profile")
      .select("role, active")
      .eq("user_id", user.id)
      .maybeSingle<{ role: UserRole; active: boolean }>();

    if (error || !data || !data.active) return false;

    return data.role === "master" || data.role === "admin";
  } catch {
    return false;
  }
}
