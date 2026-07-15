"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import type { UserRole } from "@/types/database";
import { CreateAccountInputSchema } from "@/lib/schemas/auth";
import { createAccountAction } from "@/app/(features)/accounts/actions";
import { useToast } from "@/components/ui/toast";
import { BRANCHES as BRANCH_OPTIONS, MASTER_BRANCH } from "@/config/branches";
import {
  branchDivisions,
  DEFAULT_DIVISION,
  type Division,
} from "@/config/divisions";

interface Props {
  currentUserRole: UserRole;
  currentUserBranch: string;
}

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
  const { show: showToast } = useToast();
  const [isPending, startTransition] = useTransition();

  const roleOptions =
    currentUserRole === "master" ? ROLE_OPTIONS_MASTER : ROLE_OPTIONS_ADMIN;

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>(roleOptions[0].value);
  const [branch, setBranch] = useState<string>(
    currentUserRole === "master" ? "대치" : currentUserBranch,
  );

  // 마스터 계정은 분원에 속하지 않으므로 "마스터" 분원으로 고정.
  const effectiveBranch = role === "master" ? MASTER_BRANCH : branch;

  // 발신 명의(division) — 분원에 division 이 2개 이상일 때(현재 대치)만 노출.
  // 마스터 계정은 발송 시 명의를 고르므로 필드 불필요.
  const divisionOptions = branchDivisions(effectiveBranch);
  const showDivisionField = role !== "master" && divisionOptions.length > 1;
  const [senderDivision, setSenderDivision] =
    useState<Division>(DEFAULT_DIVISION);
  // 분원이 바뀌어 현재 명의가 그 분원에서 무효면 기본(본원)으로 리셋.
  useEffect(() => {
    if (!divisionOptions.includes(senderDivision)) {
      setSenderDivision(DEFAULT_DIVISION);
    }
  }, [divisionOptions, senderDivision]);

  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    const parsed = CreateAccountInputSchema.safeParse({
      email: email.trim(),
      name: name.trim(),
      password,
      role,
      branch: effectiveBranch,
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
        password,
        role,
        branch: effectiveBranch,
        senderDivision: showDivisionField ? senderDivision : undefined,
      });

      if (result.status === "success") {
        showToast("success", `'${name.trim()}' 계정을 만들었어요`);
        router.push("/accounts");
        router.refresh();
      } else if (result.status === "dev_seed_mode") {
        setNotice(
          "개발용 시드 데이터라 실제 계정이 생성되지 않습니다. Supabase 연결 후 사용 가능합니다.",
        );
      } else {
        setErrorMsg(result.reason);
        showToast("error", `계정 생성 실패: ${result.reason}`);
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

      {/* 발급 안내 */}
      <div
        className="
          flex gap-3 rounded-lg
          border border-[color:var(--border)]
          bg-[color:var(--bg-muted)]
          px-4 py-3
        "
        role="note"
      >
        <KeyRound
          className="size-5 shrink-0 text-[color:var(--text-muted)] mt-0.5"
          strokeWidth={1.75}
          aria-hidden
        />
        <div className="text-[13px] text-[color:var(--text)] leading-relaxed">
          <p className="font-medium">
            아이디(이메일)와 비밀번호를 직접 정해 바로 발급합니다.
          </p>
          <p className="mt-1 text-[color:var(--text-muted)]">
            메일 인증 없이 즉시 로그인할 수 있습니다. 발급한 비밀번호를 사용자에게
            직접 전달하세요.
          </p>
        </div>
      </div>

      {/* 이메일 */}
      <Field
        id="acc-email"
        label="이메일 (로그인 아이디)"
        error={fieldErrors.email}
        hint="로그인 아이디로 사용됩니다. 이후 변경할 수 없습니다."
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

      {/* 비밀번호 */}
      <Field
        id="acc-password"
        label="비밀번호"
        error={fieldErrors.password}
        hint="8자 이상, 영문과 숫자를 포함하세요. 사용자에게 그대로 전달됩니다."
      >
        <input
          id="acc-password"
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="off"
          placeholder="예: sejung1234"
          maxLength={72}
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
            : role === "master"
              ? "마스터 계정은 분원에 속하지 않습니다."
              : "이 계정이 속할 분원을 선택하세요."
        }
      >
        <select
          id="acc-branch"
          value={effectiveBranch}
          disabled={currentUserRole === "admin" || role === "master"}
          onChange={(e) => setBranch(e.target.value)}
          className={`${selectClass} disabled:bg-[color:var(--bg-muted)] disabled:text-[color:var(--text-muted)] disabled:cursor-not-allowed`}
        >
          {currentUserRole === "admin" ? (
            <option value={currentUserBranch}>{currentUserBranch}</option>
          ) : role === "master" ? (
            <option value={MASTER_BRANCH}>{MASTER_BRANCH}</option>
          ) : (
            BRANCH_OPTIONS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))
          )}
        </select>
      </Field>

      {/* 발신 명의 (division 이 2개 이상인 분원만) */}
      {showDivisionField && (
        <Field
          id="acc-division"
          label="발신 명의"
          hint="이 계정이 문자 발송 시 사용할 발신 명의입니다. 발신번호·표시명이 이 값으로 정해집니다."
        >
          <select
            id="acc-division"
            value={senderDivision}
            onChange={(e) => setSenderDivision(e.target.value as Division)}
            className={selectClass}
          >
            {divisionOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>
      )}

      {/* 액션 */}
      <div className="flex items-center justify-end gap-2 pt-4 border-t border-[color:var(--border)]">
        <Link
          href="/accounts"
          className="
            inline-flex items-center justify-center
            h-11 px-4 rounded-lg
            border border-[color:var(--border)] bg-bg-card
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
          {isPending ? "생성 중..." : "계정 생성"}
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
  bg-bg-card border border-[color:var(--border)]
  text-[15px] text-[color:var(--text)]
  placeholder:text-[color:var(--text-dim)]
  focus:outline-none focus:border-[color:var(--border-strong)]
  transition-colors
`;

const selectClass = `
  w-full h-11 rounded-lg px-3
  bg-bg-card border border-[color:var(--border)]
  text-[15px] text-[color:var(--text)]
  focus:outline-none focus:border-[color:var(--border-strong)]
  cursor-pointer
`;
