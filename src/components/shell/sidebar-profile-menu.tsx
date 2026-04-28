"use client";

/**
 * 사이드바 하단 프로필 메뉴 (클라이언트 트리거 + 드롭다운).
 *
 * - 트리거: lucide MoreHorizontal 아이콘 버튼.
 * - 메뉴(shadcn DropdownMenu, 내부적으로 base-ui MenuPrimitive):
 *   1) "내 계정" → /me 로 라우팅 (next/router push)
 *   2) 구분선
 *   3) "로그아웃" → logoutAction 호출 (Server Action)
 *
 * 구현 메모:
 *  - base-ui MenuItem 의 `render` 패턴은 element type 만 바꾸고 children 은
 *    부모(MenuItem) 의 children 으로 들어간다. Link/form 을 직접 wrapping 하면
 *    의미가 모호해지므로, 클릭 핸들러 + useRouter / useTransition 으로 처리.
 *  - 메뉴 아이템 클릭 시 자연스럽게 메뉴가 닫힌다(closeOnClick 기본 true).
 */

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, UserCog, LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logoutAction } from "@/app/(features)/(auth)/actions";

export function SidebarProfileMenu() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="프로필 메뉴 열기"
        className="
          inline-flex items-center justify-center
          size-8 rounded-md
          text-[color:var(--text-muted)]
          hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text)]
          focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--text)]
          transition-colors
        "
      >
        <MoreHorizontal
          className="size-4"
          strokeWidth={1.75}
          aria-hidden
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="min-w-44">
        <DropdownMenuItem
          onClick={() => router.push("/me")}
          className="text-[14px]"
        >
          <UserCog
            className="size-4 text-[color:var(--text-muted)]"
            strokeWidth={1.75}
            aria-hidden
          />
          <span>내 계정</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            startTransition(async () => {
              await logoutAction();
            });
          }}
          disabled={pending}
          className="text-[14px]"
        >
          <LogOut
            className="size-4 text-[color:var(--text-muted)]"
            strokeWidth={1.75}
            aria-hidden
          />
          <span>{pending ? "로그아웃 중..." : "로그아웃"}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
