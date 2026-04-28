"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Lock, PowerOff, Power } from "lucide-react";
import type { UserRole } from "@/types/database";
import {
  updateAccountAction,
  deactivateAccountAction,
  reactivateAccountAction,
} from "@/app/(features)/accounts/actions";
import { BRANCHES as BRANCH_OPTIONS } from "@/config/branches";

interface TargetAccount {
  user_id: string;
  name: string;
  email: string | null;
  role: UserRole;
  branch: string;
  active: boolean;
}

interface Props {
  currentUserRole: UserRole;
  currentUserId: string;
  target: TargetAccount;
}

const ROLE_OPTIONS: Array<{ value: UserRole; label: string; hint: string }> = [
  { value: "master", label: "마스터", hint: "전 분원 모든 권한" },
  { value: "admin", label: "관리자", hint: "본인 분원 모든 권한" },
  { value: "manager", label: "매니저", hint: "본인 분원 발송·조회" },
  { value: "viewer", label: "뷰어", hint: "본인 분원 조회만" },
];

/**
 * F4 · 계정 수정 폼 (Client Component).
 *
 * 권한 분기:
 *  - 이메일      : 항상 읽기 전용
 *  - 이름        : 모두 편집 가능
 *  - 권한·분원   : master 만 활성. admin 은 비활성+툴팁
 *  - 활성 여부   : 본인 계정이면 비활성+툴팁 (자기 자신 비활성화 차단)
 *
 * 액션:
 *  - 저장        → updateAccountAction (변경분만 patch)
 *  - 비활성/활성 → 별도 버튼 + 확인 Dialog → deactivate/reactivateAccountAction
 *
 * dev_seed_mode 응답은 회색 안내, failed 는 빨간 박스.
 */
export function AccountEditForm({
  currentUserRole,
  currentUserId,
  target,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isToggling, startTogglingTransition] = useTransition();

  const isSelf = target.user_id === currentUserId;
  const canEditRoleBranch = currentUserRole === "master";

  const [name, setName] = useState(target.name);
  const [role, setRole] = useState<UserRole>(target.role);
  const [branch, setBranch] = useState<string>(target.branch);
  const [active, setActive] = useState<boolean>(target.active);

  const [pendingToggle, setPendingToggle] = useState<
    null | "deactivate" | "reactivate"
  >(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    const trimmed = name.trim();
    if (!trimmed) errs.name = "이름은 필수입니다";
    else if (trimmed.length > 20) errs.name = "이름은 20자 이내";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setNotice(null);
    setErrorMsg(null);
    if (!validate()) return;

    // 변경분만 patch 로 묶어서 보낸다 (서버는 어차피 동일 검증 수행).
    const patch: {
      user_id: string;
      name?: string;
      role?: UserRole;
      branch?: string;
      active?: boolean;
    } = { user_id: target.user_id };

    const trimmedName = name.trim();
    if (trimmedName !== target.name) patch.name = trimmedName;
    if (canEditRoleBranch && role !== target.role) patch.role = role;
    if (canEditRoleBranch && branch !== target.branch) patch.branch = branch;
    if (active !== target.active) patch.active = active;

    // 변경 사항이 없으면 빠르게 안내
    const hasChange =
      patch.name !== undefined ||
      patch.role !== undefined ||
      patch.branch !== undefined ||
      patch.active !== undefined;
    if (!hasChange) {
      setNotice("변경된 내용이 없습니다.");
      return;
    }

    startTransition(async () => {
      const result = await updateAccountAction(patch);
      if (result.status === "success") {
        setNotice("저장되었습니다.");
        router.refresh();
      } else if (result.status === "dev_seed_mode") {
        setNotice(
          "개발용 시드 데이터라 실제 수정되지 않습니다. Supabase 연결 후 동작합니다.",
        );
      } else {
        setErrorMsg(result.reason);
      }
    });
  };

  const onConfirmToggle = () => {
    if (!pendingToggle) return;
    setNotice(null);
    setErrorMsg(null);
    startTogglingTransition(async () => {
      const result =
        pendingToggle === "deactivate"
          ? await deactivateAccountAction(target.user_id)
          : await reactivateAccountAction(target.user_id);

      if (result.status === "success") {
        setActive(pendingToggle === "reactivate");
        setNotice(
          pendingToggle === "deactivate"
            ? "계정을 비활성화했습니다."
            : "계정을 활성화했습니다.",
        );
        router.refresh();
      } else if (result.status === "dev_seed_mode") {
        setNotice(
          "개발용 시드 데이터라 실제 반영되지 않습니다. Supabase 연결 후 동작합니다.",
        );
      } else {
        setErrorMsg(result.reason);
      }
      setPendingToggle(null);
    });
  };

  return (
    <>
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

        {/* 이메일 (읽기 전용) */}
        <Field id="acc-email" label="이메일" hint="이메일은 변경할 수 없습니다.">
          <div className="relative">
            <input
              id="acc-email"
              type="email"
              value={target.email ?? ""}
              readOnly
              className={`${inputClass} bg-[color:var(--bg-muted)] text-[color:var(--text-muted)] cursor-not-allowed pr-10`}
            />
            <Lock
              className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-[color:var(--text-dim)]"
              strokeWidth={1.75}
              aria-hidden
            />
          </div>
        </Field>

        {/* 이름 */}
        <Field id="acc-name" label="이름" error={fieldErrors.name}>
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
          hint={
            canEditRoleBranch
              ? undefined
              : "권한 변경은 마스터만 가능합니다."
          }
        >
          <select
            id="acc-role"
            value={role}
            disabled={!canEditRoleBranch}
            title={
              canEditRoleBranch
                ? undefined
                : "권한 변경은 마스터만 가능합니다"
            }
            onChange={(e) => setRole(e.target.value as UserRole)}
            className={`${selectClass} disabled:bg-[color:var(--bg-muted)] disabled:text-[color:var(--text-muted)] disabled:cursor-not-allowed`}
          >
            {ROLE_OPTIONS.map((opt) => (
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
          hint={
            canEditRoleBranch
              ? undefined
              : "분원 변경은 마스터만 가능합니다."
          }
        >
          <select
            id="acc-branch"
            value={branch}
            disabled={!canEditRoleBranch}
            title={
              canEditRoleBranch
                ? undefined
                : "분원 변경은 마스터만 가능합니다"
            }
            onChange={(e) => setBranch(e.target.value)}
            className={`${selectClass} disabled:bg-[color:var(--bg-muted)] disabled:text-[color:var(--text-muted)] disabled:cursor-not-allowed`}
          >
            {/* target 의 분원이 옵션 목록에 없을 수도 있어 보존 */}
            {!BRANCH_OPTIONS.includes(
              target.branch as (typeof BRANCH_OPTIONS)[number],
            ) && (
              <option value={target.branch}>{target.branch}</option>
            )}
            {BRANCH_OPTIONS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </Field>

        {/* 활성 여부 */}
        <Field
          id="acc-active"
          label="활성 상태"
          hint={
            isSelf
              ? "본인 계정은 비활성화할 수 없습니다."
              : "비활성화된 계정은 즉시 로그인이 차단됩니다."
          }
        >
          <label
            className={`
              flex items-center gap-2 h-11 px-3 rounded-lg
              border border-[color:var(--border)] bg-white
              ${isSelf ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:bg-[color:var(--bg-hover)]"}
              transition-colors
            `}
            title={
              isSelf ? "본인 계정은 비활성화할 수 없습니다" : undefined
            }
          >
            <input
              id="acc-active"
              type="checkbox"
              checked={active}
              disabled={isSelf}
              onChange={(e) => setActive(e.target.checked)}
              className="size-4 cursor-pointer accent-[color:var(--action)] disabled:cursor-not-allowed"
            />
            <span className="text-[14px] text-[color:var(--text)]">
              {active ? "활성 — 로그인 가능" : "비활성 — 로그인 차단"}
            </span>
          </label>
        </Field>

        {/* 액션 */}
        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 pt-4 border-t border-[color:var(--border)]">
          {/* 좌측: 비활성/활성 별도 버튼 */}
          <div>
            {target.active ? (
              <button
                type="button"
                disabled={isSelf || isPending || isToggling}
                onClick={() => setPendingToggle("deactivate")}
                title={
                  isSelf
                    ? "본인 계정은 비활성화할 수 없습니다"
                    : undefined
                }
                className="
                  inline-flex items-center gap-1.5 h-11 px-4 rounded-lg
                  border border-[color:var(--border)] bg-white
                  text-[14px] text-[color:var(--danger)]
                  hover:bg-[color:var(--danger-bg)]
                  disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white
                  transition-colors
                "
              >
                <PowerOff className="size-4" strokeWidth={1.75} aria-hidden />
                계정 비활성화
              </button>
            ) : (
              <button
                type="button"
                disabled={isPending || isToggling}
                onClick={() => setPendingToggle("reactivate")}
                className="
                  inline-flex items-center gap-1.5 h-11 px-4 rounded-lg
                  border border-[color:var(--border)] bg-white
                  text-[14px] text-[color:var(--text)]
                  hover:bg-[color:var(--bg-hover)]
                  disabled:opacity-40 disabled:cursor-not-allowed
                  transition-colors
                "
              >
                <Power className="size-4" strokeWidth={1.75} aria-hidden />
                계정 활성화
              </button>
            )}
          </div>

          {/* 우측: 취소 / 저장 */}
          <div className="flex items-center gap-2">
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
              disabled={isPending || isToggling}
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
                <Loader2
                  className="size-4 animate-spin"
                  strokeWidth={2}
                  aria-hidden
                />
              )}
              {isPending ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      </form>

      {/* 비활성/활성 확인 다이얼로그 */}
      {pendingToggle && (
        <ConfirmDialog
          title={
            pendingToggle === "deactivate"
              ? "계정을 비활성화할까요?"
              : "계정을 활성화할까요?"
          }
          description={
            pendingToggle === "deactivate"
              ? `'${target.name}' 계정을 비활성화합니다. 비활성화된 계정은 즉시 로그인이 차단됩니다. 다시 활성화하면 기존 권한으로 복구됩니다.`
              : `'${target.name}' 계정을 활성화합니다. 활성화 후 다시 로그인할 수 있습니다.`
          }
          confirmLabel={
            pendingToggle === "deactivate" ? "비활성화" : "활성화"
          }
          confirmTone={pendingToggle === "deactivate" ? "danger" : "default"}
          busy={isToggling}
          onCancel={() => setPendingToggle(null)}
          onConfirm={onConfirmToggle}
        />
      )}
    </>
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

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  confirmTone = "default",
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  confirmTone?: "default" | "danger";
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-white border border-[color:var(--border)] shadow-lg p-6 space-y-4">
        <h2
          id="confirm-title"
          className="text-[18px] font-semibold text-[color:var(--text)]"
        >
          {title}
        </h2>
        <p className="text-[14px] text-[color:var(--text-muted)] leading-relaxed">
          {description}
        </p>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="
              inline-flex items-center h-11 px-4 rounded-lg
              border border-[color:var(--border)] bg-white
              text-[14px] text-[color:var(--text)]
              hover:bg-[color:var(--bg-hover)]
              disabled:opacity-50
              transition-colors
            "
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`
              inline-flex items-center h-11 px-4 rounded-lg
              text-[14px] font-medium
              disabled:opacity-50 transition-colors
              ${
                confirmTone === "danger"
                  ? "bg-[color:var(--danger)] text-white hover:opacity-90"
                  : "bg-[color:var(--action)] text-[color:var(--action-text)] hover:bg-[color:var(--action-hover)]"
              }
            `}
          >
            {busy ? "처리 중..." : confirmLabel}
          </button>
        </div>
      </div>
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
