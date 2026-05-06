"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { BRANCHES } from "@/config/branches";
import { GRADE_VALUES } from "@/lib/schemas/common";
import {
  CreateStudentInputSchema,
  type CreateStudentInput,
} from "@/lib/schemas/student";
import { createStudentAction } from "@/app/(features)/students/actions";

const STATUS_OPTIONS = ["재원생", "수강이력자", "신규리드"] as const;

/**
 * F1 · 학생 직접 등록 폼.
 *
 * 본인 폰 → 학부모 연락처로 박아 발송 테스트할 때 가장 단순하게 사용.
 * 필수: 이름 / 학부모 연락처 / 분원
 * 선택: 학년 / 학교 / 상태
 */
export function StudentCreateForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const fd = new FormData(e.currentTarget);
    const raw: Partial<CreateStudentInput> = {
      name: String(fd.get("name") ?? "").trim(),
      parent_phone: String(fd.get("parent_phone") ?? "").trim(),
      branch: String(fd.get("branch") ?? "").trim(),
      grade: (fd.get("grade") || undefined) as CreateStudentInput["grade"],
      school: String(fd.get("school") ?? "").trim() || undefined,
      status: (fd.get("status") || "재원생") as CreateStudentInput["status"],
    };

    const parsed = CreateStudentInputSchema.safeParse(raw);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "입력값이 올바르지 않습니다");
      return;
    }

    startTransition(async () => {
      const result = await createStudentAction(parsed.data);
      if (result.status === "success") {
        router.push(`/students/${result.id}`);
        router.refresh();
        return;
      }
      if (result.status === "dev_seed_mode") {
        setError("개발 모드에서는 학생 등록이 차단됩니다");
        return;
      }
      setError(result.reason);
    });
  };

  return (
    <div className="max-w-xl space-y-6">
      <div className="space-y-1">
        <Link
          href="/students"
          className="text-[13px] text-[color:var(--text-muted)] hover:text-[color:var(--text)]"
        >
          ← 학생 명단
        </Link>
        <h1 className="text-[24px] font-semibold text-[color:var(--text)]">
          학생 직접 등록
        </h1>
        <p className="text-[14px] text-[color:var(--text-muted)]">
          본인 폰 번호로 학부모 연락처를 박으면 문자 발송 테스트에 바로 사용
          가능합니다. 자체 등록 학생은 `MANUAL-` 접두 ID 로 관리됩니다.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-5">
        <Field
          label="이름"
          required
          input={
            <input
              name="name"
              type="text"
              required
              maxLength={50}
              autoFocus
              placeholder="홍길동"
              className={inputClass}
            />
          }
        />

        <Field
          label="학부모 연락처"
          required
          hint="본인 폰 번호 (010-XXXX-XXXX 또는 01012345678)"
          input={
            <input
              name="parent_phone"
              type="tel"
              required
              inputMode="tel"
              placeholder="010-1234-5678"
              className={inputClass}
            />
          }
        />

        <Field
          label="분원"
          required
          input={
            <select name="branch" required defaultValue="" className={inputClass}>
              <option value="" disabled>
                선택해주세요
              </option>
              {BRANCHES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          }
        />

        <Field
          label="학년"
          input={
            <select name="grade" defaultValue="" className={inputClass}>
              <option value="">미지정</option>
              {GRADE_VALUES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          }
        />

        <Field
          label="학교"
          input={
            <input
              name="school"
              type="text"
              maxLength={50}
              placeholder="예: 휘문고"
              className={inputClass}
            />
          }
        />

        <Field
          label="상태"
          input={
            <select name="status" defaultValue="재원생" className={inputClass}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          }
        />

        {error && (
          <div
            role="alert"
            className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[14px] text-rose-700"
          >
            {error}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-[color:var(--action)] px-5 py-2.5 text-[15px] font-medium text-[color:var(--action-text)] disabled:opacity-50"
          >
            {isPending && <Loader2 className="size-4 animate-spin" />}
            등록
          </button>
          <Link
            href="/students"
            className="px-4 py-2.5 text-[15px] text-[color:var(--text-muted)] hover:text-[color:var(--text)]"
          >
            취소
          </Link>
        </div>
      </form>
    </div>
  );
}

const inputClass =
  "block w-full min-h-[40px] rounded-md border border-[color:var(--border)] bg-white px-3 text-[15px] text-[color:var(--text)] placeholder:text-[color:var(--text-dim)] focus:outline-none focus:ring-2 focus:ring-[color:var(--action)]";

function Field({
  label,
  required,
  hint,
  input,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  input: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="block text-[13px] font-medium text-[color:var(--text)]">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      {input}
      {hint && (
        <span className="block text-[12px] text-[color:var(--text-muted)]">
          {hint}
        </span>
      )}
    </label>
  );
}
