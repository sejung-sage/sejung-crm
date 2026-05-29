import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getSelectedBranch } from "@/lib/auth/branch-context";
import { BRANCHES, type Branch } from "@/config/branches";
import { NewSeminarForm } from "@/components/seminars/new-seminar-form";

/**
 * 신규 설명회 생성 (어드민) — `/seminars/new`
 *
 * ⚠️ UI MOCKUP ONLY.
 * 권한 게이트: master / admin 만 진입 가능.
 */
export default async function NewSeminarPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/login");
  if (currentUser.role !== "master" && currentUser.role !== "admin") {
    redirect("/");
  }

  const selectedBranch = await getSelectedBranch();
  const canPickBranch = currentUser.role === "master";

  // 기본 분원 결정.
  // - master: 사이드바에서 분원 선택했으면 그 분원, 아니면 "대치" (BRANCHES[0]).
  // - admin: 본인 분원 고정.
  const defaultBranch: Branch = canPickBranch
    ? ((selectedBranch as Branch | null) ?? BRANCHES[0])
    : (currentUser.branch as Branch);

  return (
    <div className="max-w-3xl space-y-6">
      <Link
        href="/seminars"
        className="inline-flex items-center gap-1 text-[13px] text-[color:var(--text-muted)] hover:text-[color:var(--text)]"
      >
        <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
        설명회
      </Link>

      <header>
        <h1 className="text-[20px] font-semibold text-[color:var(--text)]">
          새 설명회
        </h1>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          저장하면 학부모에게 공유할 공개 신청 링크가 자동으로 만들어집니다.
        </p>
      </header>

      <div className="rounded-xl border border-[color:var(--border)] bg-bg-card p-6">
        <NewSeminarForm
          canPickBranch={canPickBranch}
          defaultBranch={defaultBranch}
        />
      </div>
    </div>
  );
}
