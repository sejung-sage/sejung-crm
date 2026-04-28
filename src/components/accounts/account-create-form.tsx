"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Mail, Loader2 } from "lucide-react";
import type { UserRole } from "@/types/database";
import { CreateAccountInputSchema } from "@/lib/schemas/auth";
import { createAccountAction } from "@/app/(features)/accounts/actions";

interface Props {
  currentUserRole: UserRole;
  currentUserBranch: string;
}

const BRANCH_OPTIONS = ["대치", "송도"] as const;

const ROLE_OPTIONS_MASTER: Array<{ value: UserRole; label: string; hint: string }> =
  [
    { value: "master", label: "마스터", hint: "전 분원 모든 권한" },
    { value: "admin", label: "관리자", hint: "본인 분원 모든 권한" },
    { value: "manager", label: "매니저", hint: "본인 분원 발송·조회" },
    { value: "viewer", label: "뷰어", hint: "본인 분원 조회만" },
  ];

// admin 은 manager/viewer 만 생성 가능
const ROLE_OPTIONS_ADMIN: Array<{ value: UserRole; label: string; hint: string }> =
  [
    { value: "manager", label: "매니저", hint: "본인 분원 발송·조회" },
    { value: "viewer", label: "뷰어", hint: "본인 분원 조회만" },
  ];

/**
 * F4 · 계정 생성 폼 (Client Component).
 *
 * 권한 분기:
 *  - master  : 권한 4종 자유 선택 / 분원 자유 선택
 *  - admin   : 권한 manager/viewer 만 / 분원 본인 분원 고정·비활성
 *
 * 결과 처리:
 *  - success      → /accounts 로 이동
 *  - dev_seed_mode → 회색 안내(개발 시드 모드)
 *  - failed       → 빨간 박스 reason
 */
export function AccountCreateForm({
  currentUserRole,
  currentUserBranch,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const roleOptions =
    currentUserRole === "master" ? ROLE_OPTIONS_MASTER : ROLE_OPTIONS_ADMIN;

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>(roleOptions[0].value);
  const [branch, setBranch] = useState<string>(
    currentUserRole === "master" ? "대치" : currentUserBranch,
  );

  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    const parsed = CreateAccountInputSchema.safeParse({
      email: email.trim(),
      name: name.trim(),
      role,
      branch,
    });
    if (!parsed.success) {
      // 첫 이슈만 필드별 매핑
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]?.toString() ?? "form";
        if (!errs[key]) errs[key] = issue.message;
      }
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setNotice(null);
    setErrorMsg(null);
    if (!validate()) return;

    startTransition(async () => {
      const result = await createAccountAction({
        email: email.trim(),
        name: name.trim(),
        role,
        branch,
      });

      if (result.status === "success") {
        router.push("/accounts");
        router.refresh();
      } else if (result.status === "dev_seed_mode") {
        setNotice(
          "개발용 시드 데이터라 실제 계정이 생성되지 않습니다. Supabase 연결 후 사용 가능합니다.",
        );
      } else {
        setErrorMsg(result.reason);
      }
    });
  };

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-6 max-w-2xl"
      aria-busy={isPending}
      noValidate
    >
      {/* 안내·오류 */}
      {notice && (
        <div
          role="status"
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-4 py-2.5 text-[14px] text-[color:var(--text-muted)]"
        >
          {notice}
        </div>
      )}
      {errorMsg && (
        <div
          role="alert"
          className="rounded-lg border border-[color:var(--danger)] bg-[color:var(--danger-bg)] px-4 py-2.5 text-[14px] text-[color:var(--danger)]"
        >
          {errorMsg}
        </div>
      )}

      {/* 초대 안내 */}
      <div
        className="
          flex gap-3 rounded-lg
          border border-[color:var(--warning)]
          bg-[color:var(--warning-bg)]
          px-4 py-3
        "
        role="note"
      >
        <Mail
          className="size-5 shrink-0 text-[color:var(--warning)] mt-0.5"
          strokeWidth={1.75}
          aria-hidden
        />
        <div className="text-[13px] text-[color:var(--text)] leading-relaxed">
          <p className="font-medium">계정 생성 시 초대 메일이 자동 발송됩니다.</p>
          <p className="mt-1 text-[color:var(--text-muted)]">
            초대받은 사용자는 첫 로그인 시 비밀번호를 변경해야 합니다.
          </p>
        </div>
      </div>

      {/* 이메일 */}
      <Field
        id="acc-email"
        label="이메일"
        error={fieldErrors.email}
        hint="이 이메일로 초대 메일이 발송됩니다. 이후 변경할 수 없습니다."
      >
        <input
          id="acc-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
          inputMode="email"
          placeholder="name@example.com"
          maxLength={120}
          className={inputClass}
        />
      </Field>

      {/* 이름 */}
      <Field
        id="acc-name"
        label="이름"
        error={fieldErrors.name}
        hint="구성원이 시스템에서 표시될 이름입니다. 1~20자."
      >
        <input
          id="acc-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="예: 홍길동"
          maxLength={20}
          className={inputClass}
        />
      </Field>

      {/* 권한 */}
      <Field
        id="acc-role"
        label="권한"
        error={fieldErrors.role}
        hint={
          currentUserRole === "admin"
            ? "관리자는 매니저 또는 뷰어 권한만 부여할 수 있습니다."
            : "마스터는 전 분원 권한, 관리자는 본인 분원 권한을 가집니다."
        }
      >
        <select
          id="acc-role"
          value={role}
          onChange={(e) => setRole(e.target.value as UserRole)}
          className={selectClass}
        >
          {roleOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label} — {opt.hint}
            </option>
          ))}
        </select>
      </Field>

      {/* 분원 */}
      <Field
        id="acc-branch"
        label="분원"
        error={fieldErrors.branch}
        hint={
          currentUserRole === "admin"
            ? "관리자는 본인 분원 계정만 생성할 수 있습니다."
            : "이 계정이 속할 분원을 선택하세요."
        }
      >
        <select
          id="acc-branch"
          value={branch}
          disabled={currentUserRole === "admin"}
          onChange={(e) => setBranch(e.target.value)}
          className={`${selectClass} disabled:bg-[color:var(--bg-muted)] disabled:text-[color:var(--text-muted)] disabled:cursor-not-allowed`}
        >
          {currentUserRole === "admin" ? (
            <option value={currentUserBranch}>{currentUserBranch}</option>
          ) : (
            BRANCH_OPTIONS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))
          )}
        </select>
      </Field>

      {/* 액션 */}
      <div className="flex items-center justify-end gap-2 pt-4 border-t border-[color:var(--border)]">
        <Link
          href="/accounts"
          className="
            inline-flex items-center justify-center
            h-11 px-4 rounded-lg
            border border-[color:var(--border)] bg-white
            text-[14px] text-[color:var(--text)]
            hover:bg-[color:var(--bg-hover)]
            transition-colors
          "
        >
          취소
        </Link>
        <button
          type="submit"
          disabled={isPending}
          className="
            inline-flex items-center justify-center gap-1.5
            h-11 px-5 rounded-lg
            bg-[color:var(--action)] text-[color:var(--action-text)]
            text-[14px] font-medium
            hover:bg-[color:var(--action-hover)]
            disabled:opacity-60 disabled:cursor-not-allowed
            transition-colors
          "
        >
          {isPending && (
            <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />
          )}
          {isPending ? "생성 중..." : "계정 생성하고 초대 보내기"}
        </button>
      </div>
    </form>
  );
}

// ─── 폼 필드 공용 래퍼 ─────────────────────────────────────

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block text-[14px] font-medium text-[color:var(--text)]"
      >
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[13px] text-[color:var(--danger)]">{error}</p>
      ) : hint ? (
        <p className="text-[13px] text-[color:var(--text-dim)]">{hint}</p>
      ) : null}
    </div>
  );
}

const inputClass = `
  w-full h-11 rounded-lg px-3
  bg-white border border-[color:var(--border)]
  text-[15px] text-[color:var(--text)]
  placeholder:text-[color:var(--text-dim)]
  focus:outline-none focus:border-[color:var(--border-strong)]
  transition-colors
`;

const selectClass = `
  w-full h-11 rounded-lg px-3
  bg-white border border-[color:var(--border)]
  text-[15px] text-[color:var(--text)]
  focus:outline-none focus:border-[color:var(--border-strong)]
  cursor-pointer
`;
