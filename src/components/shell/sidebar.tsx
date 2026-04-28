import Link from "next/link";
import {
  Search,
  Users,
  GraduationCap,
  MessageSquare,
  Upload,
  UserCircle2,
} from "lucide-react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { RoleBadge } from "@/components/auth/role-badge";
import { SidebarProfileMenu } from "./sidebar-profile-menu";

/**
 * 좌측 사이드바 (폭 240px 고정)
 *
 * PRD 3.3 구조 그대로 정적 렌더:
 *  - 상단: SEJUNG Academy 로고 (Cormorant Garamond)
 *  - 검색창
 *  - 계정과 권한 관리 / 학생 명단 / 문자 발송(+하위 3개) / 데이터 관리
 *  - 하단: 현재 로그인 사용자 프로필 + 메뉴(내 계정 / 로그아웃)
 *
 * Server Component 로 유지. `getCurrentUser()` 직접 호출.
 * 사용자가 null 이면 프로필 영역을 렌더하지 않는다(미들웨어가 막아야 정상).
 */

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  children?: Array<{ href: string; label: string }>;
  /** 이 항목 위에 작은 섹션 헤더를 표시할지 여부 */
  sectionLabel?: string;
};

const NAV_ITEMS: NavItem[] = [
  {
    href: "/accounts",
    label: "계정과 권한 관리",
    icon: Users,
  },
  {
    href: "/students",
    label: "학생 명단",
    icon: GraduationCap,
  },
  {
    href: "/campaigns",
    label: "문자 발송",
    icon: MessageSquare,
    children: [
      { href: "/compose", label: "새 발송 작성" },
      { href: "/groups", label: "발송 그룹" },
      { href: "/templates", label: "문자 & 알림톡 템플릿" },
      { href: "/campaigns", label: "문자 발송 내역" },
    ],
  },
  {
    href: "/admin/import",
    label: "엑셀 가져오기",
    icon: Upload,
    sectionLabel: "데이터 관리",
  },
];

export async function Sidebar() {
  const currentUser = await getCurrentUser();
  const isDevSeed =
    currentUser?.role === "master" &&
    currentUser?.user_id === "dev-master-0001";

  return (
    <aside
      aria-label="주 메뉴"
      className="w-60 shrink-0 border-r border-border bg-[color:var(--bg)] flex flex-col h-screen sticky top-0"
    >
      {/* 로고 */}
      <div className="px-6 pt-6 pb-4">
        <Link
          href="/"
          className="font-serif text-[20px] font-medium tracking-wide text-[color:var(--text)]"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          SEJUNG Academy
        </Link>
      </div>

      {/* 검색 */}
      <div className="px-4 pb-4">
        <label className="relative block">
          <span className="sr-only">전체 검색</span>
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[color:var(--text-dim)]"
            strokeWidth={1.75}
            aria-hidden
          />
          <input
            type="search"
            placeholder="검색"
            className="
              w-full h-10 rounded-lg
              pl-9 pr-3
              bg-[color:var(--bg-muted)]
              border border-transparent
              text-[15px] text-[color:var(--text)]
              placeholder:text-[color:var(--text-dim)]
              focus:outline-none focus:border-[color:var(--border-strong)]
              focus:bg-[color:var(--bg)]
              transition-colors
            "
          />
        </label>
      </div>

      {/* 네비 */}
      <nav className="flex-1 overflow-y-auto px-2 pb-6">
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => (
            <li key={item.label}>
              {item.sectionLabel && (
                <div
                  className="mt-4 mb-1 px-3 text-[12px] font-medium uppercase tracking-wider text-[color:var(--text-dim)]"
                  aria-hidden
                >
                  {item.sectionLabel}
                </div>
              )}
              <Link
                href={item.href}
                className="
                  flex items-center gap-3 h-10 px-3 rounded-lg
                  text-[15px] text-[color:var(--text)]
                  hover:bg-[color:var(--bg-hover)]
                  transition-colors
                "
              >
                <item.icon
                  className="size-[18px] text-[color:var(--text-muted)]"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span>{item.label}</span>
              </Link>

              {/* 하위 메뉴 (문자 발송 전용) */}
              {item.children && (
                <ul className="mt-0.5 ml-10 flex flex-col gap-0.5">
                  {item.children.map((child) => (
                    <li key={child.href + child.label}>
                      <Link
                        href={child.href}
                        className="
                          flex items-center h-9 px-3 rounded-lg
                          text-[14px] text-[color:var(--text-muted)]
                          hover:bg-[color:var(--bg-hover)]
                          hover:text-[color:var(--text)]
                          transition-colors
                        "
                      >
                        {child.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </nav>

      {/* 하단 프로필 */}
      {currentUser && (
        <div className="border-t border-[color:var(--border)] px-3 py-3">
          <div className="flex items-center gap-2.5">
            <UserCircle2
              className="size-7 shrink-0 text-[color:var(--text-muted)]"
              strokeWidth={1.5}
              aria-hidden
            />
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-semibold text-[color:var(--text)] truncate leading-tight">
                {currentUser.name}
              </div>
              <div className="mt-0.5 flex items-center gap-1">
                <RoleBadge role={currentUser.role} />
                {isDevSeed && (
                  <span
                    className="inline-flex items-center h-5 px-1.5 rounded-md text-[11px] font-medium leading-none bg-[color:var(--bg-muted)] text-[color:var(--text-muted)] border border-[color:var(--border)]"
                    title="개발용 시드 사용자입니다"
                  >
                    DEV
                  </span>
                )}
              </div>
            </div>
            <SidebarProfileMenu />
          </div>
        </div>
      )}
    </aside>
  );
}
