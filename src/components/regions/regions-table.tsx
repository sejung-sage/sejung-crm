"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, Check, X } from "lucide-react";
import type { SchoolRegionRow } from "@/types/database";
import {
  upsertSchoolRegionAction,
  deleteSchoolRegionAction,
} from "@/app/(features)/regions/actions";

interface Props {
  rows: SchoolRegionRow[];
  knownRegions: string[];
}

type PendingDelete = { school: string; region: string };

/**
 * 학교 → 지역 매핑 표 (Client Component).
 *
 * 컬럼: 학교명 | 지역 | 수정 | 삭제
 *
 * 인라인 편집:
 *  - "수정" 버튼 클릭 → 그 행의 지역 셀이 dropdown 으로 토글.
 *  - 드롭다운 변경 즉시 upsertSchoolRegionAction.
 *  - 성공 시 "저장됨" 체크 아이콘 fade 700ms → router.refresh().
 *  - 취소(X) 버튼으로 편집 모드만 빠져나올 수 있음.
 *
 * 삭제:
 *  - 확인 모달 → deleteSchoolRegionAction.
 *  - 안내 문구: "삭제하면 이 학교 학생은 '기타' 로 분류됩니다."
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

  const handleSave = (school: string, region: string) => {
    setRowState((s) => ({ ...s, [school]: "saving" }));
    startSave(async () => {
      const result = await upsertSchoolRegionAction({ school, region });
      if (result.status === "success") {
        setRowState((s) => ({ ...s, [school]: "ok" }));
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
      <div className="rounded-xl border border-[color:var(--border)] bg-white py-16 text-center">
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
      <div className="rounded-xl border border-[color:var(--border)] bg-white overflow-visible">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[color:var(--border)] bg-[color:var(--bg-muted)]">
              <Th>학교명</Th>
              <Th className="w-56">지역</Th>
              <Th className="w-20 text-center">수정</Th>
              <Th className="w-20 text-center">삭제</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isEditing = editing === r.school;
              const state = rowState[r.school];
              const saving = state === "saving";
              const ok = state === "ok";
              const errorMsg =
                typeof state === "string" && state !== "saving" && state !== "ok"
                  ? state
                  : null;

              return (
                <tr
                  key={r.school}
                  className="border-b border-[color:var(--border)] last:border-b-0 hover:bg-[color:var(--bg-hover)] transition-colors"
                >
                  <Td>
                    <span className="font-medium text-[color:var(--text)]">
                      {r.school}
                    </span>
                  </Td>
                  <Td>
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <select
                          aria-label={`${r.school} 의 지역 변경`}
                          defaultValue={r.region}
                          disabled={saving || ok}
                          onChange={(e) => handleSave(r.school, e.target.value)}
                          className="
                            h-10 min-w-36 rounded-lg px-3
                            bg-white border border-[color:var(--border-strong)]
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
                            onClick={() => {
                              setEditing(null);
                              setRowState((s) => {
                                const next = { ...s };
                                delete next[r.school];
                                return next;
                              });
                            }}
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
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[color:var(--bg-muted)] text-[13px] font-medium text-[color:var(--text)]">
                        {r.region}
                      </span>
                    )}
                    {errorMsg && (
                      <p className="mt-1 text-[12px] text-[color:var(--danger)]">
                        {errorMsg}
                      </p>
                    )}
                  </Td>
                  <Td className="text-center">
                    {!isEditing && (
                      <button
                        type="button"
                        onClick={() => setEditing(r.school)}
                        aria-label={`${r.school} 매핑 수정`}
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
                    )}
                  </Td>
                  <Td className="text-center">
                    <button
                      type="button"
                      onClick={() =>
                        setPendingDelete({ school: r.school, region: r.region })
                      }
                      aria-label={`${r.school} 매핑 삭제`}
                      disabled={isEditing}
                      className="
                        inline-flex items-center justify-center
                        size-9 rounded-md
                        text-[color:var(--text-muted)]
                        hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--danger)]
                        disabled:opacity-30 disabled:cursor-not-allowed
                        transition-colors
                      "
                    >
                      <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
                    </button>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
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

// ─── 내부 소 컴포넌트 ───────────────────────────────────────

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`
        px-4 py-3 text-left text-[13px] font-medium
        text-[color:var(--text-muted)] uppercase tracking-wide
        ${className}
      `}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-3 text-[15px] ${className}`}>{children}</td>;
}

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
      <div className="w-full max-w-md rounded-xl bg-white border border-[color:var(--border)] shadow-lg p-6 space-y-4">
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
