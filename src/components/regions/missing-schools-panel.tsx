"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Check, AlertCircle } from "lucide-react";
import type { MissingSchoolRegion } from "@/lib/regions/list-missing-regions";
import { upsertSchoolRegionAction } from "@/app/(features)/regions/actions";

interface Props {
  /** 학생 수 많은 순 cap N 개. */
  items: MissingSchoolRegion[];
  /** 미매핑 학교 distinct 전체 개수 (cap 이전). */
  total: number;
  /** 표시 cap — 사용자에게 "N개 표시 중" 안내용. */
  limit: number;
  knownRegions: string[];
}

type RowState = "idle" | "saving" | "ok" | { error: string };

/**
 * 미매핑 학교 패널.
 *
 * UX (2026-05-15 개선):
 *  - 드롭다운 onChange 자동 트리거는 모바일/Safari/터치 환경에서 발화가
 *    누락되는 케이스가 있어 명시적 "저장" 버튼으로 전환. 사용자가 의도적으로
 *    클릭해야 서버 액션이 호출되므로 "골랐는데 반응 없음" 시나리오 제거.
 *  - 행 상태(저장 중·저장됨·에러)를 select 우측 큰 텍스트(14px)와 에러 박스로
 *    명확히 표시. 이전 12px 미니 텍스트는 못 보고 지나칠 위험.
 *
 * 흐름:
 *  1) 드롭다운에서 지역 선택 → 로컬 state에 selection 저장. 저장 안 됨.
 *  2) "저장" 버튼 클릭 → upsertSchoolRegionAction.
 *  3) 성공 시 "저장됨" 체크 700ms 후 router.refresh() → 행이 목록에서 사라짐.
 *  4) 실패 시 빨간 에러 박스 표시, 드롭다운/버튼 재활성.
 */
export function MissingSchoolsPanel({
  items,
  total,
  limit,
  knownRegions,
}: Props) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  // 행 단위 선택 상태: school 키 → 선택된 region 문자열.
  const [selections, setSelections] = useState<Record<string, string>>({});
  // 행 단위 처리 상태: school 키 → RowState.
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [, startTransition] = useTransition();

  const handleSave = (school: string) => {
    const region = selections[school];
    if (!region) {
      setRowState((s) => ({
        ...s,
        [school]: { error: "지역을 먼저 선택해 주세요" },
      }));
      return;
    }

    setRowState((s) => ({ ...s, [school]: "saving" }));
    startTransition(async () => {
      try {
        const result = await upsertSchoolRegionAction({ school, region });
        if (result.status === "success") {
          setRowState((s) => ({ ...s, [school]: "ok" }));
          // 잠시 보여준 후 새로고침 — 행이 list 에서 사라지고 매핑 표에 추가됨.
          setTimeout(() => router.refresh(), 700);
        } else if (result.status === "dev_seed_mode") {
          setRowState((s) => ({
            ...s,
            [school]: { error: "개발용 시드라 저장되지 않습니다" },
          }));
        } else {
          setRowState((s) => ({
            ...s,
            [school]: { error: result.reason },
          }));
        }
      } catch (e) {
        // Server Action 통신 실패(네트워크 등). 사용자가 재시도할 수 있게 명확히 표시.
        const msg = e instanceof Error ? e.message : "네트워크 오류";
        setRowState((s) => ({
          ...s,
          [school]: { error: `저장 실패 — ${msg}` },
        }));
      }
    });
  };

  // 헤더의 "N건" 은 전체 미매핑 학교 distinct 개수 (cap 이전).
  // items.length 는 cap 이 적용된 화면 표시 개수 — 둘은 다를 수 있다.
  const totalMissing = total;
  const isCapped = items.length >= limit && total > items.length;

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
            아직 지역이 지정되지 않은 학교 {totalMissing.toLocaleString()}건입니다.
            재원생 수가 많은 학교부터 지역을 선택하고 &lsquo;저장&rsquo; 버튼을
            눌러 주세요.
            {isCapped && (
              <>
                {" "}
                <span className="text-[color:var(--text)] font-medium">
                  (학생 수 많은 순으로 {limit}개 표시 중 — 매핑을 진행하면 다음
                  학교가 올라옵니다)
                </span>
              </>
            )}
            <span className="block mt-1 text-[12px] text-[color:var(--text-dim)]">
              재원생 기준 · 학생 명단의 기본 필터와 동일
            </span>
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
                const state = rowState[it.school] ?? "idle";
                const isSaving = state === "saving";
                const isOk = state === "ok";
                const errorMsg =
                  typeof state === "object" && "error" in state
                    ? state.error
                    : null;
                const selected = selections[it.school] ?? "";

                return (
                  <li
                    key={it.school}
                    className="
                      flex flex-col gap-2
                      px-4 md:px-5 py-3
                      hover:bg-[color:var(--bg-hover)]
                      transition-colors
                    "
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <span className="text-[15px] text-[color:var(--text)] font-medium truncate">
                          {it.school}
                        </span>
                        <span className="ml-2 text-[13px] text-[color:var(--text-muted)] tabular-nums">
                          재원생 {it.student_count.toLocaleString()}명
                        </span>
                      </div>

                      {isOk ? (
                        <span
                          role="status"
                          className="inline-flex items-center gap-1.5 text-[14px] font-medium text-[color:var(--success)]"
                        >
                          <Check
                            className="size-4"
                            strokeWidth={2}
                            aria-hidden
                          />
                          저장됨
                        </span>
                      ) : (
                        <>
                          <select
                            aria-label={`${it.school} 의 지역 선택`}
                            value={selected}
                            disabled={isSaving}
                            onChange={(e) => {
                              const v = e.target.value;
                              setSelections((s) => ({
                                ...s,
                                [it.school]: v,
                              }));
                              // 새로 선택하면 직전 에러는 지움.
                              setRowState((s) => {
                                const next = { ...s };
                                delete next[it.school];
                                return next;
                              });
                            }}
                            className="
                              h-10 min-w-36 rounded-lg px-3
                              bg-bg-card border border-[color:var(--border)]
                              text-[14px] text-[color:var(--text)]
                              focus:outline-none focus:border-[color:var(--border-strong)]
                              disabled:bg-[color:var(--bg-muted)] disabled:opacity-60
                              cursor-pointer
                            "
                          >
                            <option value="" disabled>
                              지역 선택
                            </option>
                            {knownRegions.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>

                          <button
                            type="button"
                            onClick={() => handleSave(it.school)}
                            disabled={isSaving || selected === ""}
                            aria-label={`${it.school} 매핑 저장`}
                            className="
                              inline-flex items-center justify-center
                              h-10 px-4 rounded-lg
                              bg-[color:var(--action)] text-[color:var(--action-text)]
                              text-[14px] font-medium
                              hover:bg-[color:var(--action-hover)]
                              disabled:bg-[color:var(--bg-muted)]
                              disabled:text-[color:var(--text-dim)]
                              disabled:cursor-not-allowed
                              transition-colors
                            "
                          >
                            {isSaving ? "저장 중..." : "저장"}
                          </button>
                        </>
                      )}
                    </div>

                    {errorMsg && (
                      <p
                        role="alert"
                        className="
                          rounded-md
                          bg-[color:var(--danger-bg)]
                          px-3 py-2
                          text-[13px] text-[color:var(--danger)]
                        "
                      >
                        {errorMsg}
                      </p>
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
