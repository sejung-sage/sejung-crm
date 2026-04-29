"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
 */
export function SidebarNavLink({
  href,
  matchPrefix = false,
  className,
  activeClassName,
  inactiveClassName,
  children,
}: {
  href: string;
  /** true 면 path 가 href 로 시작할 때도 active. 부모 메뉴용. */
  matchPrefix?: boolean;
  className: string;
  activeClassName: string;
  inactiveClassName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isActive = matchPrefix
    ? pathname === href || pathname.startsWith(`${href}/`)
    : pathname === href;

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`${className} ${isActive ? activeClassName : inactiveClassName}`}
    >
      {children}
    </Link>
  );
}
