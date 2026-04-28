"use client";

/**
 * 로그인 폼 (클라이언트 컴포넌트).
 *
 * - React 19 `useActionState` 로 Server Action 결과(LoginActionResult) 보관.
 * - 성공 시 router.push(next || '/').  next 는 동일 출처 경로만 허용(open redirect 방지).
 * - 에러는 폼 상단 빨간 박스로 노출.
 *
 * 접근성:
 *  - 이메일/비밀번호 input 모두 height 44px, 폰트 15px (40~60대 가독성).
 *  - 자동완성 attribute 명시.
 *  - 에러 박스는 role="alert".
 */

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { loginAction, type LoginActionResult } from "@/app/(features)/(auth)/actions";

type State = LoginActionResult | null;

async function submit(_prev: State, formData: FormData): Promise<State> {
  return await loginAction(formData);
}

function safeNextPath(next: string | undefined): string {
  if (!next) return "/";
  // 동일 출처 경로만 허용. 외부 URL 방지.
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<State, FormData>(
    submit,
    null,
  );

  useEffect(() => {
    if (state?.status === "success") {
      router.push(safeNextPath(next));
      router.refresh();
    }
  }, [state, next, router]);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state?.status === "failed" && (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-[14px] text-red-900"
        >
          {state.reason}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="email"
          className="text-[13px] font-medium text-[color:var(--text)]"
        >
          이메일
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          inputMode="email"
          placeholder="name@example.com"
          className="
            h-11 w-full rounded-lg
            border border-[color:var(--border-strong)]
            bg-[color:var(--bg)]
            px-3
            text-[15px] text-[color:var(--text)]
            placeholder:text-[color:var(--text-dim)]
            focus:outline-none focus:border-[color:var(--text)]
            transition-colors
          "
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="password"
          className="text-[13px] font-medium text-[color:var(--text)]"
        >
          비밀번호
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          className="
            h-11 w-full rounded-lg
            border border-[color:var(--border-strong)]
            bg-[color:var(--bg)]
            px-3
            text-[15px] text-[color:var(--text)]
            placeholder:text-[color:var(--text-dim)]
            focus:outline-none focus:border-[color:var(--text)]
            transition-colors
          "
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="
          mt-2 inline-flex items-center justify-center gap-1.5
          h-11 w-full rounded-lg
          bg-[color:var(--action)] text-[color:var(--action-text)]
          text-[15px] font-medium
          hover:bg-[color:var(--action-hover)]
          disabled:opacity-60 disabled:cursor-not-allowed
          transition-colors
        "
      >
        {pending && (
          <Loader2 className="size-4 animate-spin" aria-hidden strokeWidth={2} />
        )}
        {pending ? "로그인 중..." : "로그인"}
      </button>

      <div className="text-center">
        <a
          href="#"
          className="text-[13px] text-[color:var(--text-muted)] hover:text-[color:var(--text)] hover:underline"
        >
          비밀번호 재설정
        </a>
      </div>
    </form>
  );
}
