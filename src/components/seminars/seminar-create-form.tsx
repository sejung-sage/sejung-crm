"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import type { UserRole } from "@/types/database";
import { CreateSeminarInputSchema } from "@/lib/schemas/seminar";
import { createSeminarAction } from "@/app/(features)/seminars/actions";
import { useToast } from "@/components/ui/toast";
import { BRANCHES } from "@/config/branches";

interface Props {
  currentUserRole: UserRole;
  currentUserBranch: string;
}

/**
 * F5 · CRM 내부 설명회 생성 폼 (Client Component).
 *
 * 아카 ETL 없이 운영자가 직접 설명회를 만든다. 이름·분원은 필수, 일시·정원·
 * 설명은 선택. 생성 직후 공개 신청 페이지(open)도 함께 만들어져 바로 발송·신청
 * 가능. 권한 분기: master 는 분원 자유 선택, admin 은 본인 분원 고정.
 */
export function SeminarCreateForm({
  currentUserRole,
  currentUserBranch,
}: Props) {
  const router = useRouter();
  const { show: showToast } = useToast();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [branch, setBranch] = useState<string>(
    currentUserRole === "master" ? "대치" : currentUserBranch,
  );
  const [heldAt, setHeldAt] = useState("");
  const [capacity, setCapacity] = useState("");
  const [description, setDescription] = useState("");

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMsg(null);

    const parsed = CreateSeminarInputSchema.safeParse({
      name: name.trim(),
      branch,
      held_at: heldAt,
      capacity: capacity.trim() === "" ? null : Number(capacity),
      description,
    });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]?.toString() ?? "form";
        if (!errs[key]) errs[key] = issue.message;
      }
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});

    startTransition(async () => {
      const result = await createSeminarAction(parsed.data);
      if (result.status === "success") {
        showToast("success", `'${name.trim()}' 설명회를 만들었어요`);
        router.push(`/classes/${result.classId}`);
        router.refresh();
      } else if (result.status === "dev_seed_mode") {
        setErrorMsg(
          "개발용 시드 모드라 실제 설명회가 생성되지 않습니다. Supabase 연결 후 사용 가능합니다.",
        );
      } else {
        setErrorMsg(result.reason);
        showToast("error", `설명회 생성 실패: ${result.reason}`);
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6 max-w-2xl" aria-busy={isPending} noValidate>
      {errorMsg && (
        <div
          role="alert"
          className="rounded-lg border border-[color:var(--danger)] bg-[color:var(--danger-bg)] px-4 py-2.5 text-[14px] text-[color:var(--danger)]"
        >
          {errorMsg}
        </div>
      )}

      {/* 설명회명 */}
      <Field id="sem-name" label="설명회명" error={fieldErrors.name} hint="목록·신청 페이지에 표시될 이름입니다. 1~100자.">
        <input
          id="sem-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="예: 2026 고1 입시설명회"
          maxLength={100}
          className={inputClass}
        />
      </Field>

      {/* 분원 */}
      <Field
        id="sem-branch"
        label="분원"
        error={fieldErrors.branch}
        hint={
          currentUserRole === "admin"
            ? "관리자는 본인 분원 설명회만 만들 수 있습니다."
            : "이 설명회가 속할 분원을 선택하세요."
        }
      >
        <select
          id="sem-branch"
          value={branch}
          disabled={currentUserRole === "admin"}
          onChange={(e) => setBranch(e.target.value)}
          className={`${selectClass} disabled:bg-[color:var(--bg-muted)] disabled:text-[color:var(--text-muted)] disabled:cursor-not-allowed`}
        >
          {currentUserRole === "admin" ? (
            <option value={currentUserBranch}>{currentUserBranch}</option>
          ) : (
            BRANCHES.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))
          )}
        </select>
      </Field>

      {/* 개최 일시 (선택) */}
      <Field id="sem-held" label="개최 일시 (선택)" error={fieldErrors.held_at} hint="설명회가 열리는 날짜·시간. 비워두면 미정입니다.">
        <input
          id="sem-held"
          type="datetime-local"
          value={heldAt}
          onChange={(e) => setHeldAt(e.target.value)}
          className={inputClass}
        />
      </Field>

      {/* 정원 (선택) */}
      <Field id="sem-capacity" label="정원 (선택)" error={fieldErrors.capacity} hint="신청 정원. 비워두면 정원 제한이 없습니다.">
        <input
          id="sem-capacity"
          type="number"
          min={1}
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          placeholder="예: 50"
          className={inputClass}
        />
      </Field>

      {/* 설명 (선택) */}
      <Field id="sem-desc" label="설명 (선택)" error={fieldErrors.description} hint="학부모 신청 페이지에 노출되는 추가 안내입니다.">
        <textarea
          id="sem-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="예: 장소·준비물 등 안내"
          maxLength={2000}
          rows={4}
          className={`${inputClass} h-auto py-2.5 resize-y`}
        />
      </Field>

      {/* 액션 */}
      <div className="flex items-center justify-end gap-2 pt-4 border-t border-[color:var(--border)]">
        <Link
          href="/seminars"
          className="inline-flex items-center justify-center h-11 px-4 rounded-lg border border-[color:var(--border)] bg-bg-card text-[14px] text-[color:var(--text)] hover:bg-[color:var(--bg-hover)] transition-colors"
        >
          취소
        </Link>
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center gap-1.5 h-11 px-5 rounded-lg bg-[color:var(--action)] text-[color:var(--action-text)] text-[14px] font-medium hover:bg-[color:var(--action-hover)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {isPending && <Loader2 className="size-4 animate-spin" strokeWidth={2} aria-hidden />}
          {isPending ? "생성 중..." : "설명회 만들기"}
        </button>
      </div>
    </form>
  );
}

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
      <label htmlFor={id} className="block text-[14px] font-medium text-[color:var(--text)]">
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
