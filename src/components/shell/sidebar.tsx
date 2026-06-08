import Link from "next/link";
import {
  Users,
  GraduationCap,
  BookOpen,
  Presentation,
  MessageSquare,
  MapPin,
  BellOff,
  UserCircle2,
  Building2,
} from "lucide-react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getSelectedBranch } from "@/lib/auth/branch-context";
import { BRANCHES } from "@/config/branches";
import { RoleBadge } from "@/components/auth/role-badge";
import { SidebarProfileMenu } from "./sidebar-profile-menu";
import { SidebarNavLink } from "./sidebar-nav-link";
import { SidebarBranchSwitcher } from "./sidebar-branch-switcher";
import { SidebarClock } from "./sidebar-clock";
import { SidebarSyncStatus } from "./sidebar-sync-status";
import { getLatestSyncRun } from "@/lib/etl/sync-status";
import type { UserRole } from "@/types/database";

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
  /**
   * true 면 active 판정을 정확 경로(exact) 로만 한다.
   * "설명회"(/seminars) 처럼 하위 메뉴(/seminars/compose) 와 prefix 충돌이
   * 있는 top-level 항목 전용. 미지정이면 기존대로 matchPrefix 동작.
   */
  exact?: boolean;
  /**
   * 이 항목을 볼 수 있는 role 화이트리스트.
   * 미지정이면 모든 활성 사용자에게 노출.
   */
  roles?: ReadonlyArray<UserRole>;
};

const NAV_ITEMS: NavItem[] = [
  {
    // "계정과 권한 관리" 메뉴는 master 전용.
    // admin/manager/viewer 는 자기 분원 안에서 권한 변경 권한이 없으므로
    // 메뉴 자체를 숨겨 노이즈를 제거. (페이지 단의 RLS 가드는 그대로 유지)
    href: "/accounts",
    label: "계정과 권한 관리",
    icon: Users,
    roles: ["master"],
  },
  {
    href: "/students",
    label: "학생 명단",
    icon: GraduationCap,
  },
  {
    href: "/classes",
    label: "강좌",
    icon: BookOpen,
  },
  {
    // 설명회 전용 목록. /seminars/compose("설명회 문자") 와 prefix 충돌하므로
    // exact 매칭으로 둬 /seminars 정확 경로에서만 active.
    href: "/seminars",
    label: "설명회",
    icon: Presentation,
    exact: true,
  },
  {
    href: "/campaigns",
    label: "문자 발송",
    icon: MessageSquare,
    children: [
      // 0082 분리: 일반 SMS 와 설명회 발송 위저드를 별도 항목으로.
      // /compose 는 그룹/템플릿 기반 일반 발송, /seminars/compose 는
      // invitation 모델(학생 단위 토큰) 기반 설명회 발송.
      { href: "/compose", label: "일반 SMS 전송" },
      { href: "/seminars/compose", label: "설명회 문자" },
      { href: "/groups", label: "발송 그룹" },
      { href: "/templates", label: "문자 & 알림톡 템플릿" },
      { href: "/campaigns", label: "문자 발송 내역" },
    ],
  },
  // 설명회는 "문자 발송 > 설명회 문자" 하나로 통합 (2026-06-02).
  // 목록·신규·상세 라우트는 보존되어 그 페이지의 "설명회 목록" 탭에서 접근.
  // 엑셀 가져오기 — 2026-05-21 잠시 숨김 (Phase 1 고도화 후 재노출 예정).
  // 백엔드 route(/admin/import) + actions 는 보존 — 메뉴만 미노출.
  // {
  //   href: "/admin/import",
  //   label: "엑셀 가져오기",
  //   icon: Upload,
  //   sectionLabel: "데이터 관리",
  //   roles: ["master", "admin"],
  // },
  {
    href: "/regions",
    label: "학교 지역매핑",
    icon: MapPin,
    sectionLabel: "데이터 관리",
    roles: ["master", "admin"],
  },
  {
    // "데이터 관리" 섹션. 학교 지역매핑 바로 아래에 붙는다(sectionLabel 없음).
    // 문자 발송에서 제외할 번호를 관리하는 화면. master/admin 전용.
    href: "/unsubscribes",
    label: "수신거부 관리",
    icon: BellOff,
    roles: ["master", "admin"],
  },
];

export async function Sidebar() {
  const currentUser = await getCurrentUser();
  const selectedBranch = await getSelectedBranch();
  const latestSync = currentUser ? await getLatestSyncRun() : null;
  const isDevSeed =
    currentUser?.role === "master" &&
    currentUser?.user_id === "dev-master-0001";

  // role 가드: 항목별 roles 가 있으면 현재 role 이 포함된 것만 노출.
  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (!item.roles) return true;
    if (!currentUser) return false;
    return item.roles.includes(currentUser.role);
  });

  return (
    <aside
      aria-label="주 메뉴"
      className="w-60 shrink-0 border-r border-border bg-[color:var(--bg-card)] flex flex-col h-screen sticky top-0"
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

      {/* 분원 컨텍스트 — master 만 switcher, 그 외는 자기 분원 정적 표시 */}
      {currentUser && (
        <div className="px-4 pb-3">
          {currentUser.role === "master" ? (
            <SidebarBranchSwitcher
              current={selectedBranch}
              branches={[...BRANCHES]}
            />
          ) : (
            <div
              className="
                flex items-center gap-2 h-10 px-3 rounded-lg
                bg-[color:var(--bg-muted)]
                text-[14px] text-[color:var(--text-muted)]
              "
              aria-label="분원"
            >
              <Building2 className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
              <span className="truncate">
                분원: <span className="font-medium text-[color:var(--text)]">{currentUser.branch}</span>
              </span>
            </div>
          )}
        </div>
      )}

      {/* 네비 */}
      <nav className="flex-1 overflow-y-auto px-2 pb-6">
        <ul className="flex flex-col gap-0.5">
          {visibleNavItems.map((item) => (
            <li key={item.label}>
              {item.sectionLabel && (
                <div
                  className="mt-4 mb-1 px-3 text-[12px] font-medium uppercase tracking-wider text-[color:var(--text-dim)]"
                  aria-hidden
                >
                  {item.sectionLabel}
                </div>
              )}
              <SidebarNavLink
                href={item.href}
                matchPrefix
                exact={item.exact}
                className="
                  flex items-center gap-3 h-10 px-3 rounded-lg
                  text-[15px]
                  transition-colors
                "
                activeClassName="bg-[color:var(--bg-muted)] text-[color:var(--text)] font-semibold"
                inactiveClassName="text-[color:var(--text)] hover:bg-[color:var(--bg-hover)]"
              >
                <item.icon
                  className="size-[18px] text-[color:var(--text-muted)]"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span>{item.label}</span>
              </SidebarNavLink>

              {/* 하위 메뉴 (문자 발송 전용) */}
              {item.children && (
                <ul className="mt-0.5 ml-10 flex flex-col gap-0.5">
                  {item.children.map((child) => (
                    <li key={child.href + child.label}>
                      <SidebarNavLink
                        href={child.href}
                        className="
                          flex items-center h-9 px-3 rounded-lg
                          text-[14px]
                          transition-colors
                        "
                        activeClassName="bg-[color:var(--bg-muted)] text-[color:var(--text)] font-semibold"
                        inactiveClassName="text-[color:var(--text-muted)] hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text)]"
                      >
                        {child.label}
                      </SidebarNavLink>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </nav>

      {/* 하단 — KST 시계 + 프로필 */}
      {currentUser && (
        <div className="border-t border-[color:var(--border)] px-3 py-3 space-y-2">
          <SidebarSyncStatus run={latestSync} />
          <SidebarClock />
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
