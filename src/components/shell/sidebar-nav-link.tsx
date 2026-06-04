"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";

/**
 * 사이드바 네비게이션 링크 (Client Component).
 *
 * 현재 경로와 매칭 시 active 스타일을 적용.
 *  - 부모 메뉴 (예: /classes): 자기 경로 또는 그 하위 (/classes/123) 모두 active.
 *  - 하위 메뉴 (예: /groups): 정확히 그 경로일 때만 active.
 *
 * 부모와 자식이 동시에 active 가 되는 경우(예: /groups 가 /campaigns 하위면서
 * 동시에 부모 /campaigns 도 매칭) 가 있어, 부모는 `matchPrefix` 플래그로
 * 자기 경로와 정확히 같거나 슬래시로 시작하는 경우만 매칭하고, 자식은 정확히
 * 일치할 때만 매칭한다.
 *
 * UX 보강 (2026-05-15):
 *   `useLinkStatus()` 로 클릭 직후 server fetch 가 끝날 때까지의 pending 구간
 *   동안 우측에 작은 스피너 노출. 사용자가 "지금 이동 중" 임을 즉시 인지 가능.
 *   페이지 자체의 큰 loading.tsx 와 짝.
 */
export function SidebarNavLink({
  href,
  matchPrefix = false,
  exact = false,
  className,
  activeClassName,
  inactiveClassName,
  children,
}: {
  href: string;
  /** true 면 path 가 href 로 시작할 때도 active. 부모 메뉴용. */
  matchPrefix?: boolean;
  /**
   * true 면 `matchPrefix` 와 무관하게 정확히 같은 경로일 때만 active.
   * 예: top-level "설명회"(/seminars) 는 하위 "설명회 문자"(/seminars/compose)
   * 까지 prefix 매칭해 동시 하이라이트되므로, 이 항목만 exact 로 둬 충돌 차단.
   */
  exact?: boolean;
  className: string;
  activeClassName: string;
  inactiveClassName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isActive =
    !exact && matchPrefix
      ? pathname === href || pathname.startsWith(`${href}/`)
      : pathname === href;

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`${className} ${isActive ? activeClassName : inactiveClassName}`}
    >
      {children}
      <PendingSpinner />
    </Link>
  );
}

/**
 * 부모 Link 의 pending 상태에 반응하는 스피너.
 * `useLinkStatus()` 가 Link 의 children 트리에서만 작동하므로 별도 컴포넌트로 분리.
 */
function PendingSpinner() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <Loader2
      className="ml-auto size-3.5 animate-spin text-[color:var(--text-muted)]"
      strokeWidth={1.75}
      aria-hidden
    />
  );
}
