"use client";

/**
 * 분원 선택 폼 (master 전용).
 *
 * - "전체" + 4분원 라디오 버튼.
 * - submit 시 selectBranchAction 호출 → cookie set 후 next 경로로 redirect.
 * - 큰 버튼·라디오 (40~60대 가독성).
 */

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  selectBranchAction,
  type SelectBranchActionResult,
} from "@/app/(features)/(auth)/actions";

type State = SelectBranchActionResult | null;

async function submit(_prev: State, formData: FormData): Promise<State> {
  return await selectBranchAction(formData);
}

function safeNextPath(next: string | undefined): string {
  if (!next) return "/";
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

interface Props {
  branches: string[];
  next?: string;
}

export function SelectBranchForm({ branches, next }: Props) {
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
    <form action={formAction} className="flex flex-col gap-3" noValidate>
      {state?.status === "failed" && (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-[14px] text-red-900"
        >
          {state.reason}
        </div>
      )}

      <RadioOption
        value="전체"
        label="전체 (모든 분원)"
        defaultChecked
      />
      {branches.map((b) => (
        <RadioOption key={b} value={b} label={b} />
      ))}

      <button
        type="submit"
        disabled={pending}
        className="
          mt-2 inline-flex items-center justify-center gap-2
          h-12 px-4 rounded-lg
          bg-[color:var(--action)] text-[color:var(--action-text)]
          text-[15px] font-medium
          hover:bg-[color:var(--action-hover)]
          disabled:opacity-60 disabled:cursor-not-allowed
          transition-colors
        "
      >
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {pending ? "이동 중…" : "선택 완료"}
      </button>
    </form>
  );
}

function RadioOption({
  value,
  label,
  defaultChecked,
}: {
  value: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label
      className="
        flex items-center gap-3 h-12 px-4 rounded-lg
        border border-[color:var(--border)]
        bg-[color:var(--bg-card)]
        hover:bg-[color:var(--bg-hover)]
        cursor-pointer transition-colors
        has-[:checked]:border-[color:var(--action)]
        has-[:checked]:bg-[color:var(--bg-hover)]
      "
    >
      <input
        type="radio"
        name="branch"
        value={value}
        defaultChecked={defaultChecked}
        className="size-4 accent-black"
      />
      <span className="text-[15px] text-[color:var(--text)]">{label}</span>
    </label>
  );
}
