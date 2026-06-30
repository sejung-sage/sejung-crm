import Link from "next/link";
import { Database, ArrowLeft } from "lucide-react";

/**
 * 데이터 탐색기 전용 레이아웃.
 *
 * CRM 셸(AppShell, (features)/layout)과 의도적으로 분리 — 사이드바·브랜딩 없이
 * 풀폭 작업 화면. 별도 내부 도구 느낌. 로그인 가드는 미들웨어가, master 가드는
 * page.tsx 가 담당.
 */
export default function ExplorerLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen bg-[color:var(--bg)]">
      <header className="sticky top-0 z-30 border-b border-[color:var(--border)] bg-bg-card/90 backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-5">
          <Database
            className="size-5 text-[color:var(--text-muted)]"
            strokeWidth={1.75}
            aria-hidden
          />
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-semibold text-[color:var(--text)]">
              데이터 탐색기
            </span>
            <span className="text-[12px] text-[color:var(--text-dim)]">
              읽기 전용 · master
            </span>
          </div>
          <Link
            href="/students"
            className="
              ml-auto inline-flex items-center gap-1.5 h-9 px-3 rounded-lg
              text-[13px] font-medium text-[color:var(--text-muted)]
              hover:text-[color:var(--text)] hover:bg-[color:var(--bg-hover)]
              transition-colors
            "
          >
            <ArrowLeft className="size-4" strokeWidth={1.75} aria-hidden />
            CRM 으로
          </Link>
        </div>
      </header>
      <main className="px-5 py-5">{children}</main>
    </div>
  );
}
