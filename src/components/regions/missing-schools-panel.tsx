"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Check, AlertCircle } from "lucide-react";
import type { MissingSchoolRegion } from "@/lib/regions/list-missing-regions";
import { upsertSchoolRegionAction } from "@/app/(features)/regions/actions";

interface Props {
  items: MissingSchoolRegion[];
  knownRegions: string[];
}

/**
 * 미매핑 학교 패널.
 *
 * 화면:
 *  - 헤더: "현재 '기타' 로 분류된 학교 N건 — 자주 등장하는 학교부터 라벨링하세요."
 *  - 접기/펼치기 토글 (기본 펼침). 행 0건이면 차분한 안내로 collapsed 표시.
 *  - 각 행: 학교명 (재원생 X명) | 지역 dropdown.
 *    드롭다운에서 지역 선택 즉시 upsertSchoolRegionAction.
 *    성공 시 해당 행은 우측에 체크 아이콘 fade 후 router.refresh() 로 사라짐.
 */
export function MissingSchoolsPanel({ items, knownRegions }: Props) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  // 행 단위 처리 상태: school 키 → "saving" | "ok" | reason 문자열.
  const [rowState, setRowState] = useState<
    Record<string, "saving" | "ok" | string>
  >({});
  const [, startTransition] = useTransition();

  const handleAssign = (school: string, region: string) => {
    if (region === "" || region === "__placeholder__") return;

    setRowState((s) => ({ ...s, [school]: "saving" }));
    startTransition(async () => {
      const result = await upsertSchoolRegionAction({ school, region });
      if (result.status === "success") {
        setRowState((s) => ({ ...s, [school]: "ok" }));
        // 잠시 보여준 후 새로고침 — 행이 list 에서 사라지고, 매핑 표에 추가됨.
        setTimeout(() => router.refresh(), 700);
      } else if (result.status === "dev_seed_mode") {
        setRowState((s) => ({
          ...s,
          [school]: "개발용 시드라 저장되지 않습니다",
        }));
      } else {
        setRowState((s) => ({ ...s, [school]: result.reason }));
      }
    });
  };

  const totalMissing = items.length;

  return (
    <section
      aria-label="미매핑 학교"
      className="rounded-xl border border-[color:var(--border)] bg-bg-card"
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="
          w-full flex items-center justify-between gap-3
          px-4 md:px-5 py-3.5
          text-left
          hover:bg-[color:var(--bg-hover)]
          transition-colors
          rounded-t-xl
        "
      >
        <div className="flex items-center gap-2 min-w-0">
          <AlertCircle
            className="size-4 shrink-0 text-[color:var(--warning)]"
            strokeWidth={1.75}
            aria-hidden
          />
          <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
            매핑되지 않은 학교
          </h2>
          <span className="text-[14px] text-[color:var(--text-muted)]">
            {totalMissing.toLocaleString()}건
          </span>
        </div>
        {collapsed ? (
          <ChevronDown
            className="size-4 text-[color:var(--text-muted)]"
            strokeWidth={1.75}
            aria-hidden
          />
        ) : (
          <ChevronUp
            className="size-4 text-[color:var(--text-muted)]"
            strokeWidth={1.75}
            aria-hidden
          />
        )}
      </button>

      {!collapsed && (
        <div className="border-t border-[color:var(--border)]">
          <p className="px-4 md:px-5 py-3 text-[13px] text-[color:var(--text-muted)] leading-relaxed">
            현재 &lsquo;기타&rsquo; 로 분류된 학교 {totalMissing.toLocaleString()}건
            입니다. 재원생 수가 많은 학교부터 지역을 지정해 주세요.
          </p>

          {totalMissing === 0 ? (
            <div className="px-4 md:px-5 pb-4">
              <p className="text-[14px] text-[color:var(--text-muted)]">
                모든 학교가 매핑되어 있습니다.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-[color:var(--border)]">
              {items.map((it) => {
                const state = rowState[it.school];
                const isSaving = state === "saving";
                const isOk = state === "ok";
                const errorMsg =
                  typeof state === "string" && state !== "saving" && state !== "ok"
                    ? state
                    : null;

                return (
                  <li
                    key={it.school}
                    className="
                      flex items-center gap-3
                      px-4 md:px-5 py-2.5
                      hover:bg-[color:var(--bg-hover)]
                      transition-colors
                    "
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-[15px] text-[color:var(--text)] font-medium truncate">
                        {it.school}
                      </span>
                      <span className="ml-2 text-[13px] text-[color:var(--text-muted)] tabular-nums">
                        재원생 {it.student_count.toLocaleString()}명
                      </span>
                      {errorMsg && (
                        <p className="mt-1 text-[12px] text-[color:var(--danger)]">
                          {errorMsg}
                        </p>
                      )}
                    </div>

                    {isOk ? (
                      <span
                        role="status"
                        className="inline-flex items-center gap-1 text-[13px] text-[color:var(--success)]"
                      >
                        <Check className="size-4" strokeWidth={2} aria-hidden />
                        저장됨
                      </span>
                    ) : (
                      <select
                        aria-label={`${it.school} 의 지역 선택`}
                        defaultValue="__placeholder__"
                        disabled={isSaving}
                        onChange={(e) =>
                          handleAssign(it.school, e.target.value)
                        }
                        className="
                          h-10 min-w-36 rounded-lg px-3
                          bg-bg-card border border-[color:var(--border)]
                          text-[14px] text-[color:var(--text)]
                          focus:outline-none focus:border-[color:var(--border-strong)]
                          disabled:bg-[color:var(--bg-muted)] disabled:opacity-60
                          cursor-pointer
                        "
                      >
                        <option value="__placeholder__" disabled>
                          {isSaving ? "저장 중..." : "지역 선택"}
                        </option>
                        {knownRegions.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
