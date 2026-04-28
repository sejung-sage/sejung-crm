import { Sidebar } from "./sidebar";

/**
 * 애플리케이션 셸 래퍼
 *
 * 좌측 사이드바(240px 고정) + 우측 메인 컨텐츠.
 * 상단 여백 24px, 좌우 여백은 페이지 레이아웃에서 결정.
 *
 * 반응형은 태블릿까지만 지원. 모바일은 Phase 1+ 스코프.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-[color:var(--bg)] text-[color:var(--text)]">
      <Sidebar />
      <main className="flex-1 min-w-0 pt-6 px-8 pb-12">{children}</main>
    </div>
  );
}
