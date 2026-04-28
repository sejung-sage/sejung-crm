import { listAccounts, ACCOUNTS_PAGE_SIZE } from "@/lib/accounts/list-accounts";
import { AccountListQuerySchema } from "@/lib/schemas/auth";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { AccountsToolbar } from "@/components/accounts/accounts-toolbar";
import { AccountsTable } from "@/components/accounts/accounts-table";
import { Pagination } from "@/components/students/pagination";
import { ShieldAlert } from "lucide-react";

/**
 * F4 · 계정 관리 리스트 (/accounts)
 *
 * Server Component.
 *
 * 정책:
 *  - master/admin 만 접근. 그 외는 "권한 없음" 카드.
 *  - admin 은 본인 분원으로 query.branch 강제 덮어쓰기.
 *  - master 는 전 분원 자유 조회.
 *
 * URL 파라미터(searchParams) 는 Promise — Next 15 규약. 반드시 await.
 */
export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const currentUser = await getCurrentUser();

  // ─── 권한 가드 ────────────────────────────────────────────
  if (
    !currentUser ||
    (currentUser.role !== "master" && currentUser.role !== "admin")
  ) {
    return <ForbiddenCard />;
  }

  const raw = await searchParams;
  const pick = (v: string | string[] | undefined): string | undefined => {
    if (Array.isArray(v)) return v[0];
    return v;
  };

  const parsed = AccountListQuerySchema.parse({
    q: pick(raw.q) ?? "",
    role: pick(raw.role),
    branch: pick(raw.branch) ?? "",
    active: pick(raw.active),
    page: pick(raw.page) ?? 1,
  });

  // ─── admin 본인 분원 강제 ─────────────────────────────────
  // master 가 아니면 자신의 branch 로 덮어쓴다(URL 조작 방어 1차 — 서버에서 한 번 더).
  const effectiveQuery =
    currentUser.role === "admin"
      ? { ...parsed, branch: currentUser.branch }
      : parsed;

  const result = await listAccounts(effectiveQuery);
  const devMode = isDevSeedMode();

  return (
    <div className="max-w-7xl space-y-6">
      {/* 페이지 헤더 */}
      <header>
        <h1 className="text-[20px] font-semibold text-[color:var(--text)]">
          계정과 권한 관리
        </h1>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          학원 구성원의 계정·역할·분원을 관리합니다. 비활성화된 계정은 로그인이
          제한됩니다.
        </p>
      </header>

      {/* 툴바 */}
      <AccountsToolbar
        currentUserRole={currentUser.role}
        currentUserBranch={currentUser.branch}
      />

      {devMode && (
        <div
          role="note"
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-4 py-2.5 text-[13px] text-[color:var(--text-muted)]"
        >
          개발용 시드 데이터로 표시 중입니다. 계정 생성·수정·비활성화는 Supabase
          연결 후 실제 반영됩니다.
        </div>
      )}

      {/* 결과 수 */}
      <p className="text-[13px] text-[color:var(--text-muted)]">
        총{" "}
        <strong className="text-[color:var(--text)]">
          {result.total.toLocaleString()}
        </strong>
        명
      </p>

      {/* 테이블 */}
      <AccountsTable
        rows={result.items}
        currentUserId={currentUser.user_id}
      />

      {/* 페이지네이션 */}
      <Pagination
        page={effectiveQuery.page}
        pageSize={ACCOUNTS_PAGE_SIZE}
        total={result.total}
      />
    </div>
  );
}

// ─── 권한 없음 카드 ────────────────────────────────────────
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
          계정과 권한 관리는 마스터 또는 관리자만 접근할 수 있습니다. 권한이
          필요하면 관리자에게 문의해 주세요.
        </p>
      </div>
    </div>
  );
}
