import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ShieldAlert } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getAccount } from "@/lib/accounts/get-account";
import { AccountEditForm } from "@/components/accounts/account-edit-form";

/**
 * F4 · 계정 수정 (/accounts/[id]/edit)
 *
 * Server Component.
 *
 * 가드 순서:
 *  1) 로그인 + role ∈ {master, admin}
 *  2) 대상 계정 존재 확인 → notFound()
 *  3) admin 이 다른 분원 계정 보려고 하면 권한 없음 카드
 *
 * 폼은 클라이언트(AccountEditForm) 가 처리하며,
 * role/branch 변경 가능 여부, 본인 계정 비활성화 차단을 모두 폼 안에서 분기.
 */
export default async function EditAccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const currentUser = await getCurrentUser();

  if (
    !currentUser ||
    (currentUser.role !== "master" && currentUser.role !== "admin")
  ) {
    return <ForbiddenCard reason="계정 수정은 마스터 또는 관리자만 가능합니다." />;
  }

  const { id } = await params;
  const target = await getAccount(id);
  if (!target) {
    notFound();
  }

  // admin 은 본인 분원 계정만 수정 가능
  if (
    currentUser.role === "admin" &&
    target.branch !== currentUser.branch
  ) {
    return (
      <ForbiddenCard reason="다른 분원 계정은 조회·수정할 수 없습니다." />
    );
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
          계정 수정
        </h1>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          이름·권한·분원·활성 여부를 변경할 수 있습니다. 이메일은 변경할 수
          없습니다.
        </p>
      </header>

      <AccountEditForm
        currentUserRole={currentUser.role}
        currentUserId={currentUser.user_id}
        target={{
          user_id: target.user_id,
          name: target.name,
          email: target.email,
          role: target.role,
          branch: target.branch,
          active: target.active,
        }}
      />
    </div>
  );
}

function ForbiddenCard({ reason }: { reason: string }) {
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
          {reason}
        </p>
        <Link
          href="/accounts"
          className="
            mt-6 inline-flex items-center justify-center
            h-11 px-5 rounded-lg
            border border-[color:var(--border)] bg-white
            text-[14px] text-[color:var(--text)]
            hover:bg-[color:var(--bg-hover)]
            transition-colors
          "
        >
          계정 목록으로
        </Link>
      </div>
    </div>
  );
}
