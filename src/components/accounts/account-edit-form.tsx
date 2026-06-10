"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Loader2,
  Lock,
  PowerOff,
  Power,
  Eye,
  EyeOff,
  Sparkles,
  KeyRound,
  Copy,
  Check,
} from "lucide-react";
import type { UserRole } from "@/types/database";
import {
  updateAccountAction,
  deactivateAccountAction,
  reactivateAccountAction,
  adminResetPasswordAction,
} from "@/app/(features)/accounts/actions";
import { BRANCHES as BRANCH_OPTIONS, MASTER_BRANCH } from "@/config/branches";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { generateTempPassword } from "@/lib/auth/generate-password";

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
  const { show: showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [isToggling, startTogglingTransition] = useTransition();
  const [isResetting, startResetTransition] = useTransition();

  const isSelf = target.user_id === currentUserId;
  const canEditRoleBranch = currentUserRole === "master";
  const canResetPassword = currentUserRole === "master";

  const [name, setName] = useState(target.name);
  const [role, setRole] = useState<UserRole>(target.role);
  const [branch, setBranch] = useState<string>(target.branch);
  const [active, setActive] = useState<boolean>(target.active);

  // 마스터 계정은 분원에 속하지 않으므로 "마스터" 분원으로 고정.
  const effectiveBranch = role === "master" ? MASTER_BRANCH : branch;

  const [pendingToggle, setPendingToggle] = useState<
    null | "deactivate" | "reactivate"
  >(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // 권한·분원 등 위험도 높은 변경 확인용. 사용자 요청(2026-05-21).
  // role/branch 변경이 포함된 경우 confirm, 단순 이름·active 만이면 즉시 저장.
  type PendingPatch = {
    user_id: string;
    name?: string;
    role?: UserRole;
    branch?: string;
    active?: boolean;
  };
  const [pendingSave, setPendingSave] = useState<PendingPatch | null>(null);

  // 비밀번호 재설정용 상태 (master 전용).
  // `lastIssued` 는 재설정 성공 직후 화면에 한 번만 노출되는 평문.
  // 라우터 refresh 또는 페이지 이동 시 자연 소실되도록 별도 저장 X.
  const [pwInput, setPwInput] = useState<string>("");
  const [pwVisible, setPwVisible] = useState<boolean>(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pendingReset, setPendingReset] = useState<boolean>(false);
  const [lastIssued, setLastIssued] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

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
    const patch: PendingPatch = { user_id: target.user_id };

    const trimmedName = name.trim();
    if (trimmedName !== target.name) patch.name = trimmedName;
    if (canEditRoleBranch && role !== target.role) patch.role = role;
    if (canEditRoleBranch && effectiveBranch !== target.branch)
      patch.branch = effectiveBranch;
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

    // 권한 변경은 항상 confirm. 단순 이름 변경도 사용자 요청에 따라 confirm.
    setPendingSave(patch);
  };

  const doSave = () => {
    if (!pendingSave) return;
    const patch = pendingSave;
    startTransition(async () => {
      const result = await updateAccountAction(patch);
      if (result.status === "success") {
        setNotice("저장되었습니다.");
        setPendingSave(null);
        router.refresh();
      } else if (result.status === "dev_seed_mode") {
        setNotice(
          "개발용 시드 데이터라 실제 수정되지 않습니다. Supabase 연결 후 동작합니다.",
        );
        setPendingSave(null);
      } else {
        setErrorMsg(result.reason);
        setPendingSave(null);
      }
    });
  };

  // ── 비밀번호 재설정 핸들러 ──────────────────────────────
  const onClickGenerate = () => {
    const generated = generateTempPassword(12);
    setPwInput(generated);
    setPwVisible(true);
    setPwError(null);
  };

  const onClickReset = () => {
    setPwError(null);
    const trimmed = pwInput;
    if (trimmed.length < 8) {
      setPwError("비밀번호는 8자 이상이어야 합니다");
      return;
    }
    if (trimmed.length > 100) {
      setPwError("비밀번호가 너무 깁니다 (최대 100자)");
      return;
    }
    setPendingReset(true);
  };

  const doReset = () => {
    if (pendingReset !== true) return;
    const issued = pwInput;
    startResetTransition(async () => {
      const result = await adminResetPasswordAction({
        userId: target.user_id,
        newPassword: issued,
      });

      if (result.status === "success") {
        // 평문은 화면 노출용으로만 보존. 즉시 input 에서 지우지 않는다
        // (사용자가 자동생성 결과를 복사할 시간 필요).
        setLastIssued(issued);
        setCopied(false);
        showToast("success", result.message);
        router.refresh();
      } else if (result.status === "dev_seed_mode") {
        showToast(
          "error",
          "개발용 시드 데이터라 실제 재설정되지 않습니다. Supabase 연결 후 동작합니다.",
        );
      } else {
        setPwError(result.reason);
        showToast("error", result.reason);
      }
      setPendingReset(false);
    });
  };

  const onClickCopy = async () => {
    if (!lastIssued) return;
    try {
      await navigator.clipboard.writeText(lastIssued);
      setCopied(true);
      showToast("success", "비밀번호를 클립보드에 복사했습니다");
      // 2초 후 복사 표시 해제 (시각 피드백)
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("error", "클립보드 복사에 실패했습니다");
    }
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
            !canEditRoleBranch
              ? "분원 변경은 마스터만 가능합니다."
              : role === "master"
                ? "마스터 계정은 분원에 속하지 않습니다."
                : undefined
          }
        >
          <select
            id="acc-branch"
            value={effectiveBranch}
            disabled={!canEditRoleBranch || role === "master"}
            title={
              !canEditRoleBranch
                ? "분원 변경은 마스터만 가능합니다"
                : role === "master"
                  ? "마스터 계정은 분원에 속하지 않습니다"
                  : undefined
            }
            onChange={(e) => setBranch(e.target.value)}
            className={`${selectClass} disabled:bg-[color:var(--bg-muted)] disabled:text-[color:var(--text-muted)] disabled:cursor-not-allowed`}
          >
            {role === "master" ? (
              <option value={MASTER_BRANCH}>{MASTER_BRANCH}</option>
            ) : (
              <>
                {/* target 의 분원이 옵션 목록에 없을 수도 있어 보존 */}
                {!BRANCH_OPTIONS.includes(
                  target.branch as (typeof BRANCH_OPTIONS)[number],
                ) && <option value={target.branch}>{target.branch}</option>}
                {BRANCH_OPTIONS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </>
            )}
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
              border border-[color:var(--border)] bg-bg-card
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
                  border border-[color:var(--border)] bg-bg-card
                  text-[14px] text-[color:var(--danger)]
                  hover:bg-[color:var(--danger-bg)]
                  disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-bg-card
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
                  border border-[color:var(--border)] bg-bg-card
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

      {/* 비밀번호 재설정 (master 전용) */}
      {canResetPassword && (
        <section
          aria-labelledby="reset-pw-heading"
          className="mt-10 max-w-2xl rounded-xl border border-[color:var(--border)] bg-bg-card p-6 space-y-4"
        >
          <header className="flex items-center gap-2">
            <KeyRound
              className="size-5 text-[color:var(--text-muted)]"
              strokeWidth={1.75}
              aria-hidden
            />
            <h2
              id="reset-pw-heading"
              className="text-[16px] font-semibold text-[color:var(--text)]"
            >
              비밀번호 재설정
              <span className="ml-2 text-[12px] font-normal text-[color:var(--text-dim)]">
                마스터 전용
              </span>
            </h2>
          </header>

          {isSelf ? (
            <p className="text-[14px] text-[color:var(--text-muted)] leading-relaxed">
              본인 비밀번호는{" "}
              <Link
                href="/me"
                className="underline text-[color:var(--text)] hover:opacity-80"
              >
                내 정보 페이지
              </Link>{" "}
              에서 변경하세요.
            </p>
          ) : (
            <>
              <p className="text-[13px] text-[color:var(--text-muted)] leading-relaxed">
                임시 비밀번호를 발급합니다. 재설정 후 사용자는 다음 로그인 시
                본인이 직접 비밀번호를 다시 변경해야 합니다.
              </p>

              <Field
                id="reset-pw-input"
                label="새 비밀번호"
                hint="8자 이상. 자동 생성 또는 직접 입력."
                error={pwError ?? undefined}
              >
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      id="reset-pw-input"
                      type={pwVisible ? "text" : "password"}
                      value={pwInput}
                      onChange={(e) => {
                        setPwInput(e.target.value);
                        if (pwError) setPwError(null);
                      }}
                      placeholder="8자 이상"
                      maxLength={100}
                      autoComplete="new-password"
                      className={`${inputClass} pr-10 font-mono`}
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      onClick={() => setPwVisible((v) => !v)}
                      aria-label={
                        pwVisible ? "비밀번호 숨기기" : "비밀번호 보기"
                      }
                      className="
                        absolute right-2 top-1/2 -translate-y-1/2
                        inline-flex items-center justify-center
                        size-7 rounded-md
                        text-[color:var(--text-muted)]
                        hover:text-[color:var(--text)] hover:bg-[color:var(--bg-hover)]
                        transition-colors
                      "
                    >
                      {pwVisible ? (
                        <EyeOff
                          className="size-4"
                          strokeWidth={1.75}
                          aria-hidden
                        />
                      ) : (
                        <Eye
                          className="size-4"
                          strokeWidth={1.75}
                          aria-hidden
                        />
                      )}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={onClickGenerate}
                    disabled={isResetting}
                    className="
                      inline-flex items-center gap-1.5 h-11 px-3 rounded-lg
                      border border-[color:var(--border)] bg-bg-card
                      text-[14px] text-[color:var(--text)]
                      hover:bg-[color:var(--bg-hover)]
                      disabled:opacity-50 disabled:cursor-not-allowed
                      transition-colors
                    "
                  >
                    <Sparkles
                      className="size-4"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    자동 생성
                  </button>

                  <button
                    type="button"
                    onClick={onClickReset}
                    disabled={isResetting || pwInput.length === 0}
                    className="
                      inline-flex items-center gap-1.5 h-11 px-4 rounded-lg
                      bg-[color:var(--danger)] text-white
                      text-[14px] font-medium
                      hover:opacity-90
                      disabled:opacity-40 disabled:cursor-not-allowed
                      transition-colors
                    "
                  >
                    {isResetting && (
                      <Loader2
                        className="size-4 animate-spin"
                        strokeWidth={2}
                        aria-hidden
                      />
                    )}
                    {isResetting ? "재설정 중..." : "재설정"}
                  </button>
                </div>
              </Field>

              {lastIssued && (
                <div
                  role="status"
                  className="
                    mt-3 rounded-lg border border-[color:var(--border-strong)]
                    bg-[color:var(--bg-muted)] p-4 space-y-2.5
                  "
                >
                  <p className="text-[13px] text-[color:var(--text-muted)] leading-relaxed">
                    이 비밀번호는 <strong>한 번만 표시</strong> 됩니다. 페이지를
                    벗어나면 다시 확인할 수 없습니다. 사용자에게 안전하게
                    전달하세요.
                  </p>
                  <div className="flex items-center gap-2">
                    <code
                      className="
                        flex-1 px-3 py-2 rounded-md
                        bg-bg-card border border-[color:var(--border)]
                        font-mono text-[18px] tracking-wider text-[color:var(--text)]
                        select-all break-all
                      "
                    >
                      {lastIssued}
                    </code>
                    <button
                      type="button"
                      onClick={onClickCopy}
                      className="
                        inline-flex items-center gap-1.5 h-11 px-3 rounded-lg
                        border border-[color:var(--border)] bg-bg-card
                        text-[14px] text-[color:var(--text)]
                        hover:bg-[color:var(--bg-hover)]
                        transition-colors
                      "
                    >
                      {copied ? (
                        <>
                          <Check
                            className="size-4 text-[color:var(--success)]"
                            strokeWidth={2}
                            aria-hidden
                          />
                          복사됨
                        </>
                      ) : (
                        <>
                          <Copy
                            className="size-4"
                            strokeWidth={1.75}
                            aria-hidden
                          />
                          복사
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* 비밀번호 재설정 확인 다이얼로그 */}
      {pendingReset && (
        <ConfirmDialog
          title="비밀번호를 재설정할까요?"
          description={
            <div className="space-y-2">
              <p>
                <strong className="text-[color:var(--text)]">
                  &lsquo;{target.name}&rsquo;
                </strong>{" "}
                계정의 비밀번호를 새로 발급합니다.
              </p>
              <p className="text-[color:var(--danger)] text-[13px]">
                재설정 후 사용자는 다음 로그인 시 본인이 직접 비밀번호를 다시
                변경해야 합니다.
              </p>
            </div>
          }
          confirmLabel="재설정"
          confirmTone="danger"
          busy={isResetting}
          onCancel={() => setPendingReset(false)}
          onConfirm={doReset}
        />
      )}

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
          confirmTone={pendingToggle === "deactivate" ? "danger" : "primary"}
          busy={isToggling}
          onCancel={() => setPendingToggle(null)}
          onConfirm={onConfirmToggle}
        />
      )}

      {/* 변경 저장 확인 다이얼로그 — 권한·분원 변경은 위험도 높음 */}
      {pendingSave && (
        <ConfirmDialog
          title="계정 변경사항을 저장할까요?"
          description={
            <div className="space-y-1.5">
              <p>
                <strong className="text-[color:var(--text)]">
                  &lsquo;{target.name}&rsquo;
                </strong>{" "}
                계정의 다음 항목이 변경됩니다.
              </p>
              <ul className="list-disc pl-5 space-y-0.5">
                {pendingSave.name !== undefined && (
                  <li>
                    이름: {target.name} → {pendingSave.name}
                  </li>
                )}
                {pendingSave.role !== undefined && (
                  <li>
                    권한:{" "}
                    <span className="text-[color:var(--danger)] font-medium">
                      {target.role} → {pendingSave.role}
                    </span>
                  </li>
                )}
                {pendingSave.branch !== undefined && (
                  <li>
                    분원:{" "}
                    <span className="text-[color:var(--danger)] font-medium">
                      {target.branch} → {pendingSave.branch}
                    </span>
                  </li>
                )}
                {pendingSave.active !== undefined && (
                  <li>
                    활성 상태:{" "}
                    {target.active ? "활성" : "비활성"} →{" "}
                    {pendingSave.active ? "활성" : "비활성"}
                  </li>
                )}
              </ul>
              {(pendingSave.role !== undefined ||
                pendingSave.branch !== undefined) && (
                <p className="text-[color:var(--danger)] text-[13px] pt-1">
                  권한·분원 변경은 즉시 사용자의 접근 범위에 영향을 줍니다.
                </p>
              )}
            </div>
          }
          confirmLabel="저장"
          confirmTone={
            pendingSave.role !== undefined || pendingSave.branch !== undefined
              ? "danger"
              : "primary"
          }
          busy={isPending}
          onCancel={() => setPendingSave(null)}
          onConfirm={doSave}
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
