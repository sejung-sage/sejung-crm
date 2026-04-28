import type { UserRole } from "@/types/database";
import { cn } from "@/lib/utils";

/**
 * 권한(role) 배지.
 *
 * 디자인 규약:
 *  - master  : 검정 배경 + 흰 글씨 (강조)
 *  - admin   : 검정 외곽선 (굵은 보더)
 *  - manager : 회색 배경
 *  - viewer  : 아주 연한 회색 배경
 *
 * 색상 토큰만 사용. 보라/형광 금지.
 */

const ROLE_LABEL: Record<UserRole, string> = {
  master: "마스터",
  admin: "관리자",
  manager: "매니저",
  viewer: "뷰어",
};

const ROLE_STYLE: Record<UserRole, string> = {
  master:
    "bg-[color:var(--action)] text-[color:var(--action-text)] border border-transparent",
  admin:
    "bg-[color:var(--bg)] text-[color:var(--text)] border border-[color:var(--text)]",
  manager:
    "bg-[color:var(--bg-hover)] text-[color:var(--text)] border border-transparent",
  viewer:
    "bg-[color:var(--bg-muted)] text-[color:var(--text-muted)] border border-transparent",
};

export function RoleBadge({
  role,
  className,
}: {
  role: UserRole;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center h-5 px-1.5 rounded-md text-[12px] font-medium leading-none whitespace-nowrap",
        ROLE_STYLE[role],
        className,
      )}
      aria-label={`권한: ${ROLE_LABEL[role]}`}
    >
      {ROLE_LABEL[role]}
    </span>
  );
}
