import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { logoutAction } from "@/app/(features)/(auth)/actions";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { RoleBadge } from "@/components/auth/role-badge";

/**
 * 내 계정 페이지 (`/me`).
 *
 * Server Component. `getCurrentUser()` 가 null 이면(이론상 미들웨어가 막지만 방어)
 * `/login` 으로 redirect.
 *
 * `?forced=1` 은 첫 로그인 강제 비밀번호 변경 흐름.
 *  - 미들웨어가 must_change_password=true 사용자를 `/me?forced=1` 로 보내며
 *  - ChangePasswordForm 에서 현재 비밀번호 입력을 숨기고 안내 배너를 띄운다.
 *  - 변경 성공 시 폼이 자체적으로 2초 뒤 `/` 로 이동.
 */
export default async function MePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const forcedFromQuery = params.forced === "1";

  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  // 미들웨어가 forced=1 을 못 붙인 경로(예: 사용자가 직접 /me 접근)에서도
  // 사용자 본인이 must_change_password=true 면 강제 모드로 표시.
  const mustChange = forcedFromQuery || user.must_change_password === true;

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-[20px] font-semibold text-[color:var(--text)]">
          내 계정
        </h1>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          내 정보와 비밀번호를 확인·변경할 수 있습니다.
        </p>
      </header>

      {/* 내 정보 카드 (읽기 전용) */}
      <section
        aria-labelledby="profile-heading"
        className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] p-6"
      >
        <h2
          id="profile-heading"
          className="text-[16px] font-semibold text-[color:var(--text)] mb-4"
        >
          내 정보
        </h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <dt className="text-[13px] text-[color:var(--text-muted)] mb-1">
              이름
            </dt>
            <dd className="text-[15px] text-[color:var(--text)]">
              {user.name}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-[color:var(--text-muted)] mb-1">
              이메일
            </dt>
            <dd className="text-[15px] text-[color:var(--text)] break-all">
              {user.email}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-[color:var(--text-muted)] mb-1">
              권한
            </dt>
            <dd>
              <RoleBadge role={user.role} />
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-[color:var(--text-muted)] mb-1">
              분원
            </dt>
            <dd className="text-[15px] text-[color:var(--text)]">
              {user.branch}
            </dd>
          </div>
        </dl>
      </section>

      {/* 비밀번호 변경 카드 */}
      <section
        aria-labelledby="password-heading"
        className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] p-6"
      >
        <h2
          id="password-heading"
          className="text-[16px] font-semibold text-[color:var(--text)] mb-4"
        >
          비밀번호 변경
        </h2>
        <ChangePasswordForm mustChangePassword={mustChange} />
      </section>

      {/* 로그아웃 */}
      <section
        aria-labelledby="signout-heading"
        className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg)] p-6"
      >
        <h2
          id="signout-heading"
          className="text-[16px] font-semibold text-[color:var(--text)] mb-1"
        >
          로그아웃
        </h2>
        <p className="text-[13px] text-[color:var(--text-muted)] mb-4">
          이 기기에서 세션을 종료합니다.
        </p>
        <form action={logoutAction}>
          <button
            type="submit"
            className="
              inline-flex items-center gap-1.5
              h-10 px-4 rounded-lg
              border border-[color:var(--border-strong)]
              bg-[color:var(--bg)] text-[color:var(--text)]
              text-[14px] font-medium
              hover:bg-[color:var(--bg-hover)]
              transition-colors
            "
          >
            <LogOut className="size-4" strokeWidth={1.75} aria-hidden />
            로그아웃
          </button>
        </form>
      </section>
    </div>
  );
}
