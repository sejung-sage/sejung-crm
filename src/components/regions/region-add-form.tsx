"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, CheckCircle2 } from "lucide-react";
import { upsertSchoolRegionAction } from "@/app/(features)/regions/actions";

interface Props {
  /** dropdown 옵션 풀 — 운영자가 추가한 신규 지역도 포함되어 들어옴. */
  knownRegions: string[];
}

/**
 * 새 학교 매핑 추가 폼 (한 줄, inline).
 *
 * UX:
 *  - 학교명 input + 지역 select + 추가 버튼.
 *  - 지역 select 의 "직접 입력" 선택 시 옆에 텍스트 input 활성 (신규 지역 추가용).
 *  - 추가 성공 → 입력 비우고 "추가됨" 시각 피드백 1.5초.
 *  - 검증은 Server Action 의 Zod 결과를 받아 한글 문구로 노출.
 *
 * 정책:
 *  - upsert 라 같은 학교명 재입력 시 region 만 갱신 (UI 가 사용자에게 별도 confirm 하지 않음).
 *    이미 매핑된 학교의 region 변경은 표 인라인 편집을 권장 — add form 은 신규 추가 이미지.
 *  - dev_seed_mode 응답은 회색 안내.
 */
export function RegionAddForm({ knownRegions }: Props) {
  const router = useRouter();
  const [school, setSchool] = useState("");
  const [region, setRegion] = useState<string>(knownRegions[0] ?? "강남구");
  const [customMode, setCustomMode] = useState(false);
  const [customRegion, setCustomRegion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setNotice(null);

    const trimmedSchool = school.trim();
    const finalRegion = customMode ? customRegion.trim() : region.trim();

    if (trimmedSchool.length === 0) {
      setError("학교명을 입력하세요.");
      return;
    }
    if (finalRegion.length === 0) {
      setError("지역을 선택하거나 입력하세요.");
      return;
    }

    startTransition(async () => {
      const result = await upsertSchoolRegionAction({
        school: trimmedSchool,
        region: finalRegion,
      });

      if (result.status === "success") {
        setSuccess(`'${trimmedSchool}' → ${finalRegion} 으로 저장했습니다.`);
        setSchool("");
        if (customMode) setCustomRegion("");
        if (successTimerRef.current) clearTimeout(successTimerRef.current);
        successTimerRef.current = setTimeout(() => setSuccess(null), 2000);
        router.refresh();
      } else if (result.status === "dev_seed_mode") {
        setNotice(
          "개발용 시드 데이터라 실제 반영되지 않습니다. Supabase 연결 후 동작합니다.",
        );
      } else {
        setError(result.reason);
      }
    });
  };

  return (
    <section
      aria-label="새 학교 추가"
      className="rounded-xl border border-[color:var(--border)] bg-bg-card p-4 md:p-5"
    >
      <h2 className="text-[16px] font-semibold text-[color:var(--text)] mb-3">
        새 학교 추가
      </h2>
      <form
        onSubmit={onSubmit}
        className="flex flex-col md:flex-row md:items-end gap-3"
      >
        <label className="flex-1 min-w-0">
          <span className="block text-[13px] font-medium text-[color:var(--text-muted)] mb-1">
            학교명
          </span>
          <input
            type="text"
            value={school}
            onChange={(e) => setSchool(e.target.value)}
            placeholder="예: 휘문고"
            maxLength={50}
            disabled={isPending}
            className="
              w-full h-10 rounded-lg px-3
              bg-bg-card border border-[color:var(--border)]
              text-[15px] text-[color:var(--text)]
              placeholder:text-[color:var(--text-dim)]
              focus:outline-none focus:border-[color:var(--border-strong)]
              disabled:bg-[color:var(--bg-muted)] disabled:opacity-60
              transition-colors
            "
          />
        </label>

        <label className="md:w-48">
          <span className="block text-[13px] font-medium text-[color:var(--text-muted)] mb-1">
            지역
          </span>
          <select
            value={customMode ? "__custom__" : region}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "__custom__") {
                setCustomMode(true);
              } else {
                setCustomMode(false);
                setRegion(v);
              }
            }}
            disabled={isPending}
            className="
              w-full h-10 rounded-lg px-3
              bg-bg-card border border-[color:var(--border)]
              text-[15px] text-[color:var(--text)]
              focus:outline-none focus:border-[color:var(--border-strong)]
              disabled:bg-[color:var(--bg-muted)] disabled:opacity-60
              cursor-pointer
            "
          >
            {knownRegions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
            <option value="__custom__">+ 새 지역 직접 입력</option>
          </select>
        </label>

        {customMode && (
          <label className="md:w-48">
            <span className="block text-[13px] font-medium text-[color:var(--text-muted)] mb-1">
              새 지역명
            </span>
            <input
              type="text"
              value={customRegion}
              onChange={(e) => setCustomRegion(e.target.value)}
              placeholder="예: 분당"
              maxLength={30}
              disabled={isPending}
              className="
                w-full h-10 rounded-lg px-3
                bg-bg-card border border-[color:var(--border)]
                text-[15px] text-[color:var(--text)]
                placeholder:text-[color:var(--text-dim)]
                focus:outline-none focus:border-[color:var(--border-strong)]
                disabled:bg-[color:var(--bg-muted)] disabled:opacity-60
                transition-colors
              "
            />
          </label>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="
            inline-flex items-center justify-center gap-1.5
            h-10 px-4 rounded-lg
            bg-[color:var(--action)] text-[color:var(--action-text)]
            text-[14px] font-medium
            hover:bg-[color:var(--action-hover)]
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors
          "
        >
          <Plus className="size-4" strokeWidth={2} aria-hidden />
          {isPending ? "추가 중..." : "추가"}
        </button>
      </form>

      {/* 피드백 영역 — role=status 로 스크린리더에도 안내 */}
      {success && (
        <p
          role="status"
          className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-[color:var(--success)]"
        >
          <CheckCircle2 className="size-4" strokeWidth={2} aria-hidden />
          {success}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="mt-3 text-[13px] text-[color:var(--text-muted)]"
        >
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-[13px] text-[color:var(--danger)]">
          {error}
        </p>
      )}
    </section>
  );
}
