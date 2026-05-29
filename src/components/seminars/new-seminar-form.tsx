"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BRANCHES, type Branch } from "@/config/branches";
import { useToast } from "@/components/ui/toast";

/**
 * 새 설명회 생성 폼 — UI MOCKUP ONLY.
 *
 * 저장 시 실제 DB 호출 없이 500ms 대기 → toast → `/seminars` 로 이동.
 * 모든 필드는 클라이언트에서 가벼운 검증만 수행 (이름 필수).
 */
interface Props {
  /** master 면 분원 선택 가능. admin/manager 등은 본인 분원 고정. */
  canPickBranch: boolean;
  /** 분원 고정 케이스의 기본값. master 도 기본 선택값. */
  defaultBranch: Branch;
}

export function NewSeminarForm({ canPickBranch, defaultBranch }: Props) {
  const router = useRouter();
  const { show: showToast } = useToast();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [branch, setBranch] = useState<Branch>(defaultBranch);
  // 설명회는 하루만 진행. 날짜 + 시작 시간 분리 입력.
  const [seminarDate, setSeminarDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [venue, setVenue] = useState("");
  const [capacity, setCapacity] = useState("");
  const [deadline, setDeadline] = useState("");
  const [description, setDescription] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("설명회 이름을 입력해 주세요.");
      return;
    }
    setNameError(null);
    startTransition(async () => {
      // 목 처리 — 실제 저장 없음
      await new Promise((r) => setTimeout(r, 500));
      showToast("success", "설명회가 생성되었습니다");
      router.push("/seminars");
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-6" aria-busy={isPending}>
      <Field
        label="설명회 이름"
        required
        error={nameError ?? undefined}
        hint='예: "2026 휘문 1학년 입시설명회"'
      >
        <input
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (nameError) setNameError(null);
          }}
          placeholder="설명회 이름"
          className={inputClass}
          required
          maxLength={80}
        />
      </Field>

      <Field label="분원" required>
        {canPickBranch ? (
          <select
            value={branch}
            onChange={(e) => setBranch(e.target.value as Branch)}
            className={`${inputClass} cursor-pointer`}
          >
            {BRANCHES.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        ) : (
          <div
            className="
              flex items-center h-10 px-3 rounded-lg
              bg-[color:var(--bg-muted)]
              text-[15px] text-[color:var(--text-muted)]
            "
          >
            {branch}
          </div>
        )}
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 설명회는 하루만 진행. 날짜 + 시작 시간만 받는다(종료시간 X). */}
        <div className="grid grid-cols-2 gap-2">
          <Field label="설명회 날짜" hint="하루만 진행">
            <input
              type="date"
              value={seminarDate}
              onChange={(e) => setSeminarDate(e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="시작 시간">
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="신청 마감일시" hint="비워두면 행사 직전까지 신청 가능">
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="장소">
          <input
            type="text"
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            placeholder="예: 대치 본원 3층 대강의실"
            className={inputClass}
            maxLength={120}
          />
        </Field>

        <Field label="정원" hint="비워두면 무제한">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            placeholder="예: 40"
            className={inputClass}
          />
        </Field>
      </div>

      <Field
        label="안내문"
        hint="학부모 신청 페이지에 표시됩니다. 행사 진행 방식, 자녀 동반 가능 여부, 추후 안내 등을 적어주세요."
      >
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          maxLength={1000}
          className={`${inputClass} h-auto py-2 resize-y leading-relaxed`}
          placeholder="안내문을 입력해 주세요."
        />
        <div className="mt-1 text-right text-[12px] text-[color:var(--text-dim)]">
          {description.length} / 1000
        </div>
      </Field>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-[color:var(--border)]">
        <button
          type="button"
          onClick={() => router.push("/seminars")}
          disabled={isPending}
          className="
            inline-flex items-center h-10 px-4 rounded-lg
            border border-[color:var(--border)] bg-bg-card
            text-[14px] text-[color:var(--text)]
            hover:bg-[color:var(--bg-hover)]
            disabled:opacity-50
            transition-colors
          "
        >
          취소
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="
            inline-flex items-center h-10 px-4 rounded-lg
            bg-[color:var(--action)] text-[color:var(--action-text)]
            text-[14px] font-medium
            hover:bg-[color:var(--action-hover)]
            disabled:opacity-50
            transition-colors
          "
        >
          {isPending ? "저장 중..." : "저장"}
        </button>
      </div>
    </form>
  );
}

const inputClass = `
  w-full h-10 rounded-lg px-3
  bg-bg-card border border-[color:var(--border-strong)]
  text-[15px] text-[color:var(--text)]
  placeholder:text-[color:var(--text-dim)]
  focus:outline-none focus:border-[color:var(--text)]
  transition-colors
`;

function Field({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center gap-1 text-[14px] font-medium text-[color:var(--text)]">
        {label}
        {required && (
          <span className="text-[color:var(--danger)]" aria-hidden>
            *
          </span>
        )}
      </span>
      {children}
      {error ? (
        <span
          role="alert"
          className="block text-[12px] text-[color:var(--danger)]"
        >
          {error}
        </span>
      ) : hint ? (
        <span className="block text-[12px] text-[color:var(--text-muted)]">
          {hint}
        </span>
      ) : null}
    </label>
  );
}
