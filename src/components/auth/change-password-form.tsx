"use client";

/**
 * 비밀번호 변경 폼 (클라이언트 컴포넌트).
 *
 * 두 가지 모드:
 *  1) 일반(`mustChangePassword=false`): 현재 비밀번호 + 새 비밀번호 + 확인.
 *  2) 강제(`mustChangePassword=true`): 새 비밀번호 + 확인. 현재 비밀번호 입력 숨김.
 *     성공 시 노란 배너 안내 → 2초 후 `/` 로 이동.
 *
 * Server Action 결과는 ChangePasswordActionResult.
 *  - dev_seed_mode → 회색 안내 (실제 변경 없음)
 *  - failed → 빨간 박스 (reason)
 *  - success → 초록 박스
 */

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  changePasswordAction,
  type ChangePasswordActionResult,
} from "@/app/(features)/(auth)/actions";

type Status =
  | { kind: "idle" }
  | { kind: "client_error"; reason: string }
  | { kind: "result"; result: ChangePasswordActionResult };

const INPUT_CLASS = `
  h-11 w-full rounded-lg
  border border-[color:var(--border-strong)]
  bg-[color:var(--bg)]
  px-3
  text-[15px] text-[color:var(--text)]
  placeholder:text-[color:var(--text-dim)]
  focus:outline-none focus:border-[color:var(--text)]
  transition-colors
`;

export function ChangePasswordForm({
  mustChangePassword,
}: {
  mustChangePassword: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // 강제 변경이 성공하면 2초 후 홈으로 이동
  useEffect(() => {
    if (
      mustChangePassword &&
      status.kind === "result" &&
      status.result.status === "success"
    ) {
      const t = setTimeout(() => {
        router.push("/");
        router.refresh();
      }, 2000);
      return () => clearTimeout(t);
    }
  }, [status, mustChangePassword, router]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus({ kind: "idle" });

    // 클라이언트 1차 검증 (서버에서 Zod 로 재검증)
    if (!mustChangePassword && currentPassword.length === 0) {
      setStatus({
        kind: "client_error",
        reason: "현재 비밀번호를 입력하세요",
      });
      return;
    }
    if (newPassword.length < 8) {
      setStatus({
        kind: "client_error",
        reason: "새 비밀번호는 8자 이상이어야 합니다",
      });
      return;
    }
    if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setStatus({
        kind: "client_error",
        reason: "새 비밀번호는 영문과 숫자를 포함해야 합니다",
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      setStatus({
        kind: "client_error",
        reason: "새 비밀번호 확인이 일치하지 않습니다",
      });
      return;
    }

    startTransition(async () => {
      const result = await changePasswordAction({
        currentPassword: mustChangePassword ? undefined : currentPassword,
        newPassword,
        confirmPassword,
      });
      setStatus({ kind: "result", result });

      // 성공 시 입력값 비움 (강제 변경은 곧 이동되므로 의미 적지만 통일)
      if (result.status === "success") {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      }
    });
  }

  // 결과 박스
  let resultBox: React.ReactNode = null;
  if (status.kind === "client_error") {
    resultBox = (
      <div
        role="alert"
        className="rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-[14px] text-red-900"
      >
        {status.reason}
      </div>
    );
  } else if (status.kind === "result") {
    const r = status.result;
    if (r.status === "success") {
      resultBox = (
        <div
          role="status"
          className="rounded-lg border border-green-300 bg-green-50 px-3 py-2.5 text-[14px] text-green-900"
        >
          비밀번호가 변경되었습니다.
          {mustChangePassword ? " 잠시 후 메인 화면으로 이동합니다." : ""}
        </div>
      );
    } else if (r.status === "dev_seed_mode") {
      resultBox = (
        <div
          role="status"
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-3 py-2.5 text-[14px] text-[color:var(--text-muted)]"
        >
          개발용 시뮬레이션 모드입니다. 실제 비밀번호는 변경되지 않습니다.
        </div>
      );
    } else {
      resultBox = (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-[14px] text-red-900"
        >
          {r.reason}
        </div>
      );
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      {mustChangePassword && (
        <div
          role="alert"
          className="rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2.5 text-[14px] text-yellow-900"
        >
          첫 로그인입니다. 사용을 시작하기 전에 새 비밀번호를 설정해주세요.
        </div>
      )}

      {resultBox}

      {!mustChangePassword && (
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="currentPassword"
            className="text-[13px] font-medium text-[color:var(--text)]"
          >
            현재 비밀번호
          </label>
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="newPassword"
          className="text-[13px] font-medium text-[color:var(--text)]"
        >
          새 비밀번호
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className={INPUT_CLASS}
        />
        <p className="text-[12px] text-[color:var(--text-muted)]">
          8자 이상, 영문·숫자 포함
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="confirmPassword"
          className="text-[13px] font-medium text-[color:var(--text)]"
        >
          새 비밀번호 확인
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className={INPUT_CLASS}
        />
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={pending}
          className="
            inline-flex items-center justify-center gap-1.5
            h-11 min-w-[140px] px-5 rounded-lg
            bg-[color:var(--action)] text-[color:var(--action-text)]
            text-[15px] font-medium
            hover:bg-[color:var(--action-hover)]
            disabled:opacity-60 disabled:cursor-not-allowed
            transition-colors
          "
        >
          {pending && (
            <Loader2
              className="size-4 animate-spin"
              aria-hidden
              strokeWidth={2}
            />
          )}
          {pending ? "변경 중..." : "비밀번호 변경"}
        </button>
      </div>
    </form>
  );
}
