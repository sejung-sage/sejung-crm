import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SelectBranchForm } from "@/components/auth/select-branch-form";
import { BRANCHES } from "@/config/branches";

/**
 * 분원 선택 페이지 (`/select-branch`).
 *
 * 로그인 후 master 만 진입. role≠master 인 사용자는 loginAction 이 자기
 * branch 를 자동 cookie 박고 홈으로 보내므로 이 페이지에 도달하지 않는다.
 *
 * 직접 URL 진입 시(예: master 가 분원 다시 바꾸려고)도 동일 가드 적용.
 *
 * Server Component — currentUser 검사만 하고 form 은 client 로 위임.
 */
export default async function SelectBranchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();

  // 미로그인 → /login
  if (!user) redirect("/login");

  // master 외 사용자는 분원 선택 권한 없음 → 홈으로
  if (user.role !== "master") redirect("/");

  const raw = await searchParams;
  const nextRaw = raw.next;
  const next = typeof nextRaw === "string" ? nextRaw : "/";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <h1
            className="text-[28px] font-medium tracking-wide text-[color:var(--text)]"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            SEJUNG Academy
          </h1>
          <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
            어느 분원으로 들어갈까요?
          </p>
        </div>

        <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-card)] p-8 shadow-sm">
          <h2 className="text-[16px] font-semibold text-[color:var(--text)] mb-5">
            분원 선택
          </h2>
          <SelectBranchForm branches={[...BRANCHES]} next={next} />
        </div>

        <p className="mt-6 text-center text-[12px] text-[color:var(--text-dim)]">
          마스터 권한은 모든 분원에 접근할 수 있습니다.
        </p>
      </div>
    </div>
  );
}
