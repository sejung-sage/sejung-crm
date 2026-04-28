import Link from "next/link";
import { ChevronLeft, ShieldAlert } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { AccountCreateForm } from "@/components/accounts/account-create-form";

/**
 * F4 · 계정 생성 (/accounts/new)
 *
 * Server Component. master/admin 만 접근 허용.
 * 폼은 클라이언트 컴포넌트(AccountCreateForm) 로 위임하고
 * 현재 사용자의 role/branch 만 props 로 내려준다.
 */
export default async function NewAccountPage() {
  const currentUser = await getCurrentUser();

  if (
    !currentUser ||
    (currentUser.role !== "master" && currentUser.role !== "admin")
  ) {
    return <ForbiddenCard />;
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Link
        href="/accounts"
        className="inline-flex items-center gap-1 text-[13px] text-[color:var(--text-muted)] hover:text-[color:var(--text)]"
      >
        <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
        계정과 권한 관리
      </Link>

      <header>
        <h1 className="text-[20px] font-semibold text-[color:var(--text)]">
          새 계정 생성
        </h1>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          학원 구성원의 계정을 만들고 권한과 분원을 지정합니다. 초대 메일이
          자동으로 발송됩니다.
        </p>
      </header>

      <AccountCreateForm
        currentUserRole={currentUser.role}
        currentUserBranch={currentUser.branch}
      />
    </div>
  );
}

function ForbiddenCard() {
  return (
    <div className="max-w-2xl">
      <div className="rounded-xl border border-[color:var(--border)] bg-white p-8 text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-[color:var(--bg-muted)]">
          <ShieldAlert
            className="size-6 text-[color:var(--text-muted)]"
            strokeWidth={1.75}
            aria-hidden
          />
        </div>
        <h1 className="text-[18px] font-semibold text-[color:var(--text)]">
          권한이 없습니다
        </h1>
        <p className="mt-2 text-[14px] text-[color:var(--text-muted)] leading-relaxed">
          계정 생성은 마스터 또는 관리자만 가능합니다.
        </p>
      </div>
    </div>
  );
}
