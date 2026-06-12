import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SeminarCreateForm } from "@/components/seminars/seminar-create-form";

/**
 * CRM 내부 설명회 생성 (/seminars/new)
 *
 * Server Component 래퍼. master / admin 만 접근(설명회 = 강좌 write/group 권한).
 * 폼은 클라이언트 컴포넌트(SeminarCreateForm)에서 처리.
 */
export default async function NewSeminarPage() {
  const currentUser = await getCurrentUser();

  const canCreate =
    currentUser != null &&
    currentUser.active &&
    (currentUser.role === "master" || currentUser.role === "admin");

  return (
    <div className="max-w-3xl space-y-6">
      <Link
        href="/seminars"
        className="inline-flex items-center gap-1 text-[13px] text-[color:var(--text-muted)] hover:text-[color:var(--text)]"
      >
        <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
        설명회 목록
      </Link>

      <header>
        <h1 className="text-[20px] font-semibold text-[color:var(--text)]">
          새 설명회 만들기
        </h1>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          아카 등록 없이 CRM에서 직접 설명회를 만듭니다. 생성하면 공개 신청
          페이지도 함께 열려 바로 발송·신청을 받을 수 있습니다.
        </p>
      </header>

      {canCreate ? (
        <SeminarCreateForm
          currentUserRole={currentUser.role}
          currentUserBranch={currentUser.branch}
        />
      ) : (
        <div
          role="alert"
          className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-muted)] p-6 text-[14px] text-[color:var(--text-muted)]"
        >
          설명회 생성은 마스터 또는 분원 관리자만 할 수 있습니다.
        </div>
      )}
    </div>
  );
}
