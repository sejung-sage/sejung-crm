import { LoginForm } from "@/components/auth/login-form";

/**
 * 로그인 페이지 (`/login`).
 *
 * Server Component. searchParams 는 Next 16 에서 Promise.
 *  - `?next=/students` : 로그인 후 돌아갈 경로 (LoginForm 에서 동일 출처만 허용)
 *  - `?deactivated=1`  : 미들웨어가 비활성 계정을 자동 로그아웃시킬 때 부여
 *
 * 풀스크린 가운데 정렬 카드. 사이드바 없음(`(auth)` 그룹 레이아웃).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const nextRaw = params.next;
  const deactivated = params.deactivated;
  const next = typeof nextRaw === "string" ? nextRaw : undefined;
  const isDeactivated = deactivated === "1";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* 로고 */}
        <div className="text-center mb-6">
          <h1
            className="text-[28px] font-medium tracking-wide text-[color:var(--text)]"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            SEJUNG Academy
          </h1>
          <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
            세정학원 CRM
          </p>
        </div>

        {/* 카드 */}
        <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)] p-8 shadow-sm">
          <h2 className="text-[16px] font-semibold text-[color:var(--text)] mb-5">
            로그인
          </h2>

          {isDeactivated && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2.5 text-[14px] text-yellow-900"
            >
              계정이 비활성화되었습니다. 관리자에게 문의하세요.
            </div>
          )}

          <LoginForm next={next} />
        </div>

        <p className="mt-6 text-center text-[12px] text-[color:var(--text-dim)]">
          관리자에게 받은 이메일과 비밀번호로 로그인하세요.
        </p>
      </div>
    </div>
  );
}
