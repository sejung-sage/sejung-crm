import Link from "next/link";
import { ChevronRight, BellOff, ShieldAlert } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { listUnsubscribesAction } from "./actions";
import { UnsubscribeAddForm } from "@/components/unsubscribes/unsubscribe-add-form";
import { UnsubscribesTable } from "@/components/unsubscribes/unsubscribes-table";

/**
 * 관리 · 수신거부 관리 (/unsubscribes)
 *
 * Server Component.
 *
 * 정책:
 *  - master / admin 만 접근. 그 외는 ForbiddenCard.
 *  - URL ?q=... 로 번호·학생명 검색.
 *  - "해제" 권한은 master 만 (canRemove). admin 은 등록만 가능.
 *
 * 데이터:
 *  - 목록: listUnsubscribesAction(q) — backend 가 제공.
 */
export default async function UnsubscribesPage({
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
  const pick = (v: string | string[] | undefined): string => {
    if (Array.isArray(v)) return v[0] ?? "";
    return v ?? "";
  };
  const q = pick(raw.q).trim();

  const result = await listUnsubscribesAction(q || undefined);
  const rows = result.status === "success" ? result.data : [];

  // 해제는 최고관리자(master)만. admin 은 등록만 가능.
  const canRemove = currentUser.role === "master";

  const devMode = isDevSeedMode();

  return (
    <div className="max-w-5xl space-y-6">
      {/* 브레드크럼 */}
      <nav
        aria-label="현재 위치"
        className="flex items-center gap-1 text-[13px] text-[color:var(--text-muted)]"
      >
        <span>관리</span>
        <ChevronRight className="size-3.5" strokeWidth={1.75} aria-hidden />
        <span className="text-[color:var(--text)] font-medium">
          수신거부 관리
        </span>
      </nav>

      {/* 페이지 헤더 */}
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-[20px] font-semibold text-[color:var(--text)]">
          <BellOff className="size-5" strokeWidth={1.75} aria-hidden />
          수신거부 관리
        </h1>
        <p className="text-[14px] text-[color:var(--text-muted)] leading-relaxed">
          문자 발송에서 제외할 번호를 관리합니다. 등록된 번호로는 문자가
          발송되지 않고 캠페인에 &lsquo;실패(수신거부)&rsquo;로 표시됩니다.
        </p>
      </header>

      {devMode && (
        <div
          role="note"
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-4 py-2.5 text-[13px] text-[color:var(--text-muted)]"
        >
          개발용 시드 데이터로 표시 중입니다. 추가·해제는 Supabase 연결 후 실제
          반영됩니다.
        </div>
      )}

      {result.status === "failed" && (
        <div
          role="alert"
          className="rounded-lg border border-[color:var(--danger)] bg-[color:var(--danger-bg)] px-4 py-2.5 text-[14px] text-[color:var(--danger)]"
        >
          {result.reason}
        </div>
      )}

      {/* 번호 추가 폼 */}
      <UnsubscribeAddForm />

      {/* 검색 바 */}
      <UnsubscribesSearchBar q={q} />

      {/* 목록 표 */}
      <UnsubscribesTable rows={rows} canRemove={canRemove} />
    </div>
  );
}

// ─── 검색 바 (Server Component, GET form) ──────────────────

function UnsubscribesSearchBar({ q }: { q: string }) {
  return (
    <form
      method="get"
      action="/unsubscribes"
      className="flex flex-col md:flex-row md:items-end gap-3"
    >
      <label className="flex-1 min-w-0">
        <span className="block text-[13px] font-medium text-[color:var(--text-muted)] mb-1">
          번호 · 학생명 검색
        </span>
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="예: 010-1234-5678 또는 홍길동"
          className="
            w-full h-10 rounded-lg px-3
            bg-bg-card border border-[color:var(--border)]
            text-[15px] text-[color:var(--text)]
            placeholder:text-[color:var(--text-dim)]
            focus:outline-none focus:border-[color:var(--border-strong)]
            transition-colors
          "
        />
      </label>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="
            inline-flex items-center justify-center
            h-10 px-4 rounded-lg
            bg-[color:var(--action)] text-[color:var(--action-text)]
            text-[14px] font-medium
            hover:bg-[color:var(--action-hover)]
            transition-colors
          "
        >
          검색
        </button>
        {q !== "" && (
          <Link
            href="/unsubscribes"
            className="
              inline-flex items-center justify-center
              h-10 px-4 rounded-lg
              border border-[color:var(--border)] bg-bg-card
              text-[14px] text-[color:var(--text-muted)]
              hover:text-[color:var(--text)] hover:bg-[color:var(--bg-hover)]
              transition-colors
            "
          >
            초기화
          </Link>
        )}
      </div>
    </form>
  );
}

// ─── 권한 없음 카드 ────────────────────────────────────────

function ForbiddenCard() {
  return (
    <div className="max-w-2xl">
      <div className="rounded-xl border border-[color:var(--border)] bg-bg-card p-8 text-center">
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
          수신거부 관리는 마스터 또는 관리자만 접근할 수 있습니다. 권한이
          필요하면 원장에게 문의해 주세요.
        </p>
      </div>
    </div>
  );
}
