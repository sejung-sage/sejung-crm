"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, Check, X, ChevronDown } from "lucide-react";
import type { SchoolRegionRow } from "@/types/database";
import {
  upsertSchoolRegionAction,
  deleteSchoolRegionAction,
} from "@/app/(features)/regions/actions";
import { REGION_OPTIONS } from "@/config/regions";

interface Props {
  rows: SchoolRegionRow[];
  knownRegions: string[];
}

type PendingDelete = { school: string; region: string };

/**
 * 학교 → 지역 매핑 표 (Client Component).
 *
 * 그룹화 (2026-05-15):
 *   - 1차 그룹: 지역 (SSOT REGION_OPTIONS 순서 + 그 외 자유 지역은 한글 정렬로 뒤에).
 *     각 지역은 접기/펼치기 가능 (기본 접힘).
 *   - 2차 그룹: 학교급 (고등학교 / 중학교 / 기타) — 학교명 끝 패턴 자동 판별.
 *     사용자 요청대로 한 지역 안에서 고→중→기타 순으로 sub-section 분리.
 *
 * 인라인 편집/삭제 로직은 그대로:
 *   - "수정" 버튼 → 지역 셀이 dropdown 으로 토글 → 변경 즉시 upsert.
 *   - 삭제 버튼 → 확인 모달 → delete. "기타 로 분류됩니다" 안내.
 */
export function RegionsTable({ rows, knownRegions }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [rowState, setRowState] = useState<
    Record<string, "saving" | "ok" | string>
  >({});
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, startDelete] = useTransition();
  const [, startSave] = useTransition();
  // 지역별 펼침 상태. 기본: 모두 접힘.
  const [openRegions, setOpenRegions] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => groupByRegionAndLevel(rows), [rows]);

  const toggleRegion = (region: string) => {
    setOpenRegions((prev) => {
      const next = new Set(prev);
      if (next.has(region)) next.delete(region);
      else next.add(region);
      return next;
    });
  };

  const handleSave = (school: string, region: string) => {
    setRowState((s) => ({ ...s, [school]: "saving" }));
    startSave(async () => {
      const result = await upsertSchoolRegionAction({ school, region });
      if (result.status === "success") {
        setRowState((s) => ({ ...s, [school]: "ok" }));
        // 새 region 그룹을 자동으로 펼친다 — 학교가 다른 그룹으로 이동한 경우
        // 사용자가 같은 자리에서 보이는 변화가 없어 "안 됐다" 고 오해하던 UX 버그 해결.
        setOpenRegions((prev) => {
          const next = new Set(prev);
          next.add(region);
          return next;
        });
        setTimeout(() => {
          setEditing(null);
          setRowState((s) => {
            const next = { ...s };
            delete next[school];
            return next;
          });
          router.refresh();
        }, 700);
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

  const confirmDelete = () => {
    if (!pendingDelete) return;
    setDeleteError(null);
    startDelete(async () => {
      const result = await deleteSchoolRegionAction(pendingDelete.school);
      if (result.status === "success") {
        setPendingDelete(null);
        router.refresh();
      } else if (result.status === "dev_seed_mode") {
        setDeleteError("개발용 시드라 삭제되지 않습니다");
      } else {
        setDeleteError(result.reason);
      }
    });
  };

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-bg-card py-16 text-center">
        <p className="text-[15px] text-[color:var(--text-muted)]">
          매핑된 학교가 없습니다.
        </p>
        <p className="mt-2 text-[13px] text-[color:var(--text-dim)]">
          위의 &lsquo;새 학교 추가&rsquo; 또는 미매핑 학교 패널에서 매핑을 시작할
          수 있습니다.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {grouped.map(({ region, total, byLevel }) => {
          const isOpen = openRegions.has(region);
          return (
            <section
              key={region}
              aria-label={`${region} 매핑`}
              className="rounded-xl border border-[color:var(--border)] bg-bg-card overflow-hidden"
            >
              <button
                type="button"
                onClick={() => toggleRegion(region)}
                aria-expanded={isOpen}
                className="
                  w-full flex items-center justify-between gap-3
                  px-4 md:px-5 py-3.5
                  text-left
                  hover:bg-[color:var(--bg-hover)]
                  transition-colors
                "
              >
                <div className="flex items-center gap-2 min-w-0">
                  <h3 className="text-[16px] font-semibold text-[color:var(--text)]">
                    {region}
                  </h3>
                  <span className="text-[14px] text-[color:var(--text-muted)] tabular-nums">
                    {total.toLocaleString()}개 매핑
                  </span>
                </div>
                <ChevronDown
                  className={`size-4 text-[color:var(--text-muted)] transition-transform ${
                    isOpen ? "rotate-180" : ""
                  }`}
                  strokeWidth={1.75}
                  aria-hidden
                />
              </button>

              {isOpen && total === 0 && (
                <div className="border-t border-[color:var(--border)] px-4 md:px-5 py-6 text-center">
                  <p className="text-[14px] text-[color:var(--text-muted)]">
                    이 지역으로 매핑된 학교가 없습니다.
                  </p>
                  <p className="mt-1 text-[13px] text-[color:var(--text-dim)]">
                    위의 &lsquo;새 학교 추가&rsquo; 또는 미매핑 학교 패널, 또는
                    다른 그룹에서 학교 &lsquo;수정&rsquo; 으로 옮겨올 수 있습니다.
                  </p>
                </div>
              )}

              {isOpen && total > 0 && (
                <div className="border-t border-[color:var(--border)]">
                  {LEVELS.map((level) => {
                    const levelRows = byLevel[level];
                    if (levelRows.length === 0) return null;
                    return (
                      <div
                        key={level}
                        className="border-b border-[color:var(--border)] last:border-b-0"
                      >
                        <h4 className="px-4 md:px-5 py-2 bg-[color:var(--bg-muted)] text-[13px] font-medium text-[color:var(--text-muted)]">
                          {LEVEL_LABELS[level]}
                          <span className="ml-1.5 tabular-nums">
                            ({levelRows.length})
                          </span>
                        </h4>
                        <ul className="divide-y divide-[color:var(--border)]">
                          {levelRows.map((r) => (
                            <SchoolRow
                              key={r.school}
                              row={r}
                              isEditing={editing === r.school}
                              state={rowState[r.school]}
                              knownRegions={knownRegions}
                              onEdit={() => setEditing(r.school)}
                              onCancel={() => {
                                setEditing(null);
                                setRowState((s) => {
                                  const next = { ...s };
                                  delete next[r.school];
                                  return next;
                                });
                              }}
                              onSave={handleSave}
                              onDelete={() =>
                                setPendingDelete({
                                  school: r.school,
                                  region: r.region,
                                })
                              }
                            />
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="매핑을 삭제할까요?"
          description={`'${pendingDelete.school}' → ${pendingDelete.region} 매핑을 삭제합니다. 이 학교의 학생들은 '기타' 로 분류됩니다. 다시 매핑하면 즉시 복구할 수 있습니다.`}
          confirmLabel="삭제"
          confirmTone="danger"
          busy={isDeleting}
          onCancel={() => {
            if (isDeleting) return;
            setPendingDelete(null);
            setDeleteError(null);
          }}
          onConfirm={confirmDelete}
          errorMessage={deleteError}
        />
      )}
    </>
  );
}

// ─── 학교 row ─────────────────────────────────────────────────

function SchoolRow({
  row,
  isEditing,
  state,
  knownRegions,
  onEdit,
  onCancel,
  onSave,
  onDelete,
}: {
  row: SchoolRegionRow;
  isEditing: boolean;
  state: "saving" | "ok" | string | undefined;
  knownRegions: string[];
  onEdit: () => void;
  onCancel: () => void;
  onSave: (school: string, region: string) => void;
  onDelete: () => void;
}) {
  const saving = state === "saving";
  const ok = state === "ok";
  const errorMsg =
    typeof state === "string" && state !== "saving" && state !== "ok"
      ? state
      : null;

  return (
    <li className="flex items-center gap-3 px-4 md:px-5 py-2.5 hover:bg-[color:var(--bg-hover)] transition-colors">
      <div className="flex-1 min-w-0">
        <span className="text-[15px] font-medium text-[color:var(--text)] truncate">
          {row.school}
        </span>
        {errorMsg && (
          <p className="mt-1 text-[12px] text-[color:var(--danger)]">
            {errorMsg}
          </p>
        )}
      </div>

      {isEditing ? (
        <div className="flex items-center gap-2">
          <select
            aria-label={`${row.school} 의 지역 변경`}
            defaultValue={row.region}
            disabled={saving || ok}
            onChange={(e) => onSave(row.school, e.target.value)}
            className="
              h-10 min-w-36 rounded-lg px-3
              bg-bg-card border border-[color:var(--border-strong)]
              text-[14px] text-[color:var(--text)]
              focus:outline-none
              disabled:bg-[color:var(--bg-muted)] disabled:opacity-60
              cursor-pointer
            "
          >
            {knownRegions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          {ok ? (
            <span
              role="status"
              className="inline-flex items-center gap-1 text-[13px] text-[color:var(--success)]"
            >
              <Check className="size-4" strokeWidth={2} aria-hidden />
              저장됨
            </span>
          ) : (
            <button
              type="button"
              onClick={onCancel}
              aria-label="편집 취소"
              className="
                inline-flex items-center justify-center
                size-8 rounded-md
                text-[color:var(--text-muted)]
                hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text)]
                transition-colors
              "
            >
              <X className="size-4" strokeWidth={1.75} aria-hidden />
            </button>
          )}
        </div>
      ) : (
        <>
          <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[color:var(--bg-muted)] text-[13px] font-medium text-[color:var(--text)]">
            {row.region}
          </span>
          <button
            type="button"
            onClick={onEdit}
            aria-label={`${row.school} 매핑 수정`}
            className="
              inline-flex items-center justify-center
              size-9 rounded-md
              text-[color:var(--text-muted)]
              hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text)]
              transition-colors
            "
          >
            <Pencil className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`${row.school} 매핑 삭제`}
            className="
              inline-flex items-center justify-center
              size-9 rounded-md
              text-[color:var(--text-muted)]
              hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--danger)]
              transition-colors
            "
          >
            <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
        </>
      )}
    </li>
  );
}

// ─── 그룹화 헬퍼 ───────────────────────────────────────────────

type SchoolLevel = "고" | "중" | "초" | "기타";
const LEVELS: ReadonlyArray<SchoolLevel> = ["고", "중", "초", "기타"];
const LEVEL_LABELS: Record<SchoolLevel, string> = {
  고: "고등학교",
  중: "중학교",
  초: "초등학교",
  기타: "기타 (대학교 등)",
};

/**
 * 학교명 끝 패턴으로 학교급 자동 판별.
 *
 * 우선순위: 더 구체적인 패턴(○○고등학교)이 단순 끝글자(○○고)보다 먼저.
 * 단순 끝글자 매칭은 줄임형(휘문고/대치중/대도초) 잡기 위함.
 */
function detectSchoolLevel(school: string): SchoolLevel {
  const s = school.trim();
  if (s.endsWith("대학교")) return "기타";
  if (s.endsWith("고등학교")) return "고";
  if (s.endsWith("중학교")) return "중";
  if (s.endsWith("초등학교")) return "초";
  if (s.endsWith("고")) return "고";
  if (s.endsWith("중")) return "중";
  if (s.endsWith("초")) return "초";
  return "기타";
}

interface RegionGroup {
  region: string;
  total: number;
  byLevel: Record<SchoolLevel, SchoolRegionRow[]>;
}

/**
 * 매핑 row 들을 지역 → 학교급으로 2단 그룹화.
 *
 * 지역 순서: SSOT REGION_OPTIONS 가 먼저, 그 외 자유 지역은 한글 정렬로 뒤에.
 * SSOT region 은 매핑 0개라도 그룹 표시 — 사용자가 "왜 안 보이지" 헷갈리지
 * 않게. 자유 지역(예: '분당구') 은 매핑 있을 때만 표시.
 * 학교급 내 정렬: 학교명 한글 가나다순.
 */
function groupByRegionAndLevel(rows: SchoolRegionRow[]): RegionGroup[] {
  const byRegion = new Map<string, SchoolRegionRow[]>();
  // SSOT 모든 region 을 빈 list 로 미리 채움 — 0개라도 그룹 표시 보장.
  for (const r of REGION_OPTIONS) byRegion.set(r, []);

  for (const r of rows) {
    const list = byRegion.get(r.region) ?? [];
    list.push(r);
    byRegion.set(r.region, list);
  }

  // 정렬: SSOT 순서 → 그 외 한글 정렬.
  const ssotOrder = new Map<string, number>(
    REGION_OPTIONS.map((r, i) => [r, i]),
  );
  const sortedRegions = [...byRegion.keys()].sort((a, b) => {
    const ai = ssotOrder.get(a);
    const bi = ssotOrder.get(b);
    if (ai !== undefined && bi !== undefined) return ai - bi;
    if (ai !== undefined) return -1;
    if (bi !== undefined) return 1;
    return a.localeCompare(b, "ko");
  });

  return sortedRegions.map((region) => {
    const regionRows = byRegion.get(region) ?? [];
    const byLevel: Record<SchoolLevel, SchoolRegionRow[]> = {
      고: [],
      중: [],
      초: [],
      기타: [],
    };
    for (const r of regionRows) {
      byLevel[detectSchoolLevel(r.school)].push(r);
    }
    for (const level of LEVELS) {
      byLevel[level].sort((a, b) => a.school.localeCompare(b.school, "ko"));
    }
    return { region, total: regionRows.length, byLevel };
  });
}

// ─── 확인 모달 ────────────────────────────────────────────────

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  confirmTone = "default",
  busy,
  onCancel,
  onConfirm,
  errorMessage,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  confirmTone?: "default" | "danger";
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  errorMessage?: string | null;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="region-confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-bg-card border border-[color:var(--border)] shadow-lg p-6 space-y-4">
        <h2
          id="region-confirm-title"
          className="text-[18px] font-semibold text-[color:var(--text)]"
        >
          {title}
        </h2>
        <p className="text-[14px] text-[color:var(--text-muted)] leading-relaxed">
          {description}
        </p>
        {errorMessage && (
          <p
            role="alert"
            className="rounded-lg border border-[color:var(--danger)] bg-[color:var(--danger-bg)] px-3 py-2 text-[13px] text-[color:var(--danger)]"
          >
            {errorMessage}
          </p>
        )}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="
              inline-flex items-center h-11 px-4 rounded-lg
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
