"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Link2,
  GraduationCap,
  ArrowRight,
  Undo2,
  Trash2,
  Loader2,
} from "lucide-react";
import type { ClassStudentRow } from "@/types/database";
import type { ClassSignupParentRow } from "@/lib/seminars/get-class-signup-page";
import { formatPhone } from "@/lib/phone";
import { formatKstDateTime } from "@/lib/datetime";
import {
  setSignupsRosterAddedAction,
  cancelSignupsAction,
} from "@/app/(features)/seminars/actions";
import { useToast } from "@/components/ui/toast";

interface Props {
  /** 아카에 등록된 수강생 (crm_classes ↔ enrollments). */
  acaStudents: ClassStudentRow[];
  /** CRM 공개 신청 페이지에서 신청 완료(signed)한 학부모/학생. */
  crmSignups: ClassSignupParentRow[];
  /** 운영자 편집 권한(write/group). false 면 보기 전용. */
  canManage: boolean;
}

/** 전체 명단 한 행 — 아카 등록 ∪ 운영자가 추가한 CRM 신청. */
interface UnionRow {
  id: string;
  name: string;
  school: string | null;
  grade: string | null;
  aca: boolean;
  crm: boolean;
  itemId: string | null;
}

/**
 * 설명회 상세 명단.
 *  - 좌: CRM 신청생(미편입). 체크 후 "전체 명단에 추가"로 한번에 편입.
 *  - 우: 전체 명단 = 아카 등록 ∪ 운영자가 추가한 CRM 신청. 추가분은 ↩ 로 되돌리기.
 *  - 둘 다 비파괴 — 신청 자체는 삭제되지 않는다(roster_added 플래그만 토글).
 */
export function SeminarRosterPanels({
  acaStudents,
  crmSignups,
  canManage,
}: Props) {
  const router = useRouter();
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // 낙관적 오버라이드 — 서버 응답 전에 즉시 화면 반영(체감 속도). 실패 시 되돌림.
  //  - override: item_id → 전체 명단 편입 여부(true/false)
  //  - removed : item_id → 삭제됨(명단에서 제거)
  const [override, setOverride] = useState<Map<string, boolean>>(new Map());
  const [removed, setRemoved] = useState<Set<string>>(new Set());

  const isAdded = useMemo(
    () => (p: ClassSignupParentRow) =>
      override.has(p.item_id) ? override.get(p.item_id)! : p.added,
    [override],
  );

  const acaStudentIds = useMemo(
    () => new Set(acaStudents.map((s) => s.id)),
    [acaStudents],
  );

  const pending = useMemo(
    () => crmSignups.filter((p) => !removed.has(p.item_id) && !isAdded(p)),
    [crmSignups, removed, isAdded],
  );

  const rightRows: UnionRow[] = useMemo(() => {
    const added = crmSignups.filter(
      (p) => !removed.has(p.item_id) && isAdded(p),
    );
    const addedByStudent = new Map(added.map((p) => [p.student_id, p]));
    const map = new Map<string, UnionRow>();
    for (const s of acaStudents) {
      const a = addedByStudent.get(s.id);
      map.set(s.id, {
        id: s.id,
        name: s.name,
        school: s.school,
        grade: s.grade ? String(s.grade) : null,
        aca: true,
        crm: Boolean(a),
        itemId: a?.item_id ?? null,
      });
    }
    for (const p of added) {
      const ex = map.get(p.student_id);
      if (ex) {
        ex.crm = true;
        ex.itemId = p.item_id;
      } else {
        map.set(p.student_id, {
          id: p.student_id,
          name: p.student_name,
          school: p.school,
          grade: p.grade,
          aca: false,
          crm: true,
          itemId: p.item_id,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "ko"),
    );
  }, [acaStudents, crmSignups, removed, isAdded]);

  // 화면에 보이는 pending 중 선택된 것만 유효 선택으로 카운트.
  const pendingIds = useMemo(() => new Set(pending.map((p) => p.item_id)), [
    pending,
  ]);
  const selectedCount = useMemo(
    () => [...selected].filter((id) => pendingIds.has(id)).length,
    [selected, pendingIds],
  );
  const allSelected = pending.length > 0 && selectedCount === pending.length;

  const toggleOne = (itemId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(pending.map((p) => p.item_id)));
  };

  const moveSelected = () => {
    const ids = pending.map((p) => p.item_id).filter((id) => selected.has(id));
    if (ids.length === 0) return;
    // 즉시 화면 반영(낙관적): 좌→우 이동.
    setOverride((prev) => {
      const n = new Map(prev);
      ids.forEach((id) => n.set(id, true));
      return n;
    });
    setSelected(new Set());
    // 서버는 뒤에서 처리. 실패 시 되돌림.
    startTransition(async () => {
      const r = await setSignupsRosterAddedAction(ids, true);
      if (r.status === "success") {
        router.refresh();
      } else {
        setOverride((prev) => {
          const n = new Map(prev);
          ids.forEach((id) => n.delete(id));
          return n;
        });
        show(
          "error",
          r.status === "dev_seed_mode"
            ? "개발 시드 모드라 반영되지 않습니다."
            : r.reason,
        );
      }
    });
  };

  const deleteSelected = () => {
    const ids = pending.map((p) => p.item_id).filter((id) => selected.has(id));
    if (ids.length === 0) return;
    // 즉시 화면에서 제거(낙관적).
    setRemoved((prev) => {
      const n = new Set(prev);
      ids.forEach((id) => n.add(id));
      return n;
    });
    setSelected(new Set());
    setConfirmingDelete(false);
    startTransition(async () => {
      const r = await cancelSignupsAction(ids);
      if (r.status === "success") {
        router.refresh();
      } else {
        setRemoved((prev) => {
          const n = new Set(prev);
          ids.forEach((id) => n.delete(id));
          return n;
        });
        show(
          "error",
          r.status === "dev_seed_mode"
            ? "개발 시드 모드라 반영되지 않습니다."
            : r.reason,
        );
      }
    });
  };

  const undoOne = (itemId: string) => {
    // 즉시 우→좌 이동(낙관적).
    setOverride((prev) => new Map(prev).set(itemId, false));
    startTransition(async () => {
      const r = await setSignupsRosterAddedAction([itemId], false);
      if (r.status === "success") {
        router.refresh();
      } else {
        setOverride((prev) => {
          const n = new Map(prev);
          n.delete(itemId);
          return n;
        });
        show(
          "error",
          r.status === "dev_seed_mode"
            ? "개발 시드 모드라 반영되지 않습니다."
            : r.reason,
        );
      }
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      {/* 좌 — CRM 신청생 (체크 → 한번에 추가) */}
      <Panel
        icon={
          <Link2
            className="size-4 text-[color:var(--text-muted)]"
            strokeWidth={1.75}
            aria-hidden
          />
        }
        title="CRM 신청생"
        count={pending.length}
      >
        {pending.length === 0 ? (
          <EmptyRow message="추가 대기 중인 신청이 없습니다." />
        ) : (
          <>
            {canManage && (
              <div className="flex items-center gap-3 px-4 py-2 border-b border-[color:var(--border)] bg-bg-card sticky top-0 z-10">
                <label className="flex items-center gap-2 cursor-pointer text-[13px] text-[color:var(--text-muted)]">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="size-4 accent-[color:var(--action)]"
                  />
                  전체 선택
                </label>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  disabled={selectedCount === 0 || isPending}
                  className="
                    inline-flex items-center gap-1.5 h-8 px-3 rounded-md
                    border border-[color:var(--danger)] bg-bg-card
                    text-[13px] font-medium text-[color:var(--danger)]
                    hover:bg-[color:var(--danger-bg)]
                    disabled:opacity-40 disabled:cursor-not-allowed
                    transition-colors
                  "
                >
                  <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
                  삭제
                </button>
                <button
                  type="button"
                  onClick={moveSelected}
                  disabled={selectedCount === 0 || isPending}
                  className="
                    inline-flex items-center gap-1.5 h-8 px-3 rounded-md
                    bg-[color:var(--action)] text-[color:var(--action-text)]
                    text-[13px] font-medium
                    hover:bg-[color:var(--action-hover)]
                    disabled:opacity-40 disabled:cursor-not-allowed
                    transition-colors
                  "
                >
                  {isPending ? (
                    <Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden />
                  ) : (
                    <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
                  )}
                  선택 {selectedCount}명 전체 명단에 추가
                </button>
              </div>
            )}
            <ul className="divide-y divide-[color:var(--border)]">
              {pending.map((p) => (
                <li
                  key={p.item_id}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  {canManage && (
                    <input
                      type="checkbox"
                      checked={selected.has(p.item_id)}
                      onChange={() => toggleOne(p.item_id)}
                      aria-label={`${p.student_name} 선택`}
                      className="size-4 accent-[color:var(--action)] shrink-0"
                    />
                  )}
                  <span className="font-medium text-[15px] text-[color:var(--text)] truncate">
                    {p.student_name}
                  </span>
                  {acaStudentIds.has(p.student_id) && <Badge>아카</Badge>}
                  <span className="text-[13px] text-[color:var(--text-muted)] tabular-nums">
                    {p.parent_phone ? formatPhone(p.parent_phone) || "—" : "—"}
                  </span>
                  <div className="flex-1" />
                  <span className="text-[12px] text-[color:var(--text-dim)] tabular-nums shrink-0">
                    {formatKstDateTime(p.signed_at)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      {/* 우 — 전체 명단 (아카 ∪ 추가한 CRM) */}
      <Panel
        icon={
          <GraduationCap
            className="size-4 text-[color:var(--text-muted)]"
            strokeWidth={1.75}
            aria-hidden
          />
        }
        title="전체 명단"
        count={rightRows.length}
      >
        {rightRows.length === 0 ? (
          <EmptyRow message="명단이 비어 있습니다." />
        ) : (
          <ul className="divide-y divide-[color:var(--border)]">
            {rightRows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="font-medium text-[15px] text-[color:var(--text)] truncate">
                  {r.name}
                </span>
                <span className="text-[13px] text-[color:var(--text-muted)] truncate">
                  {formatSchoolGrade(r.school, r.grade)}
                </span>
                <div className="flex-1" />
                <SourceCell on={r.aca}>아카</SourceCell>
                <SourceCell on={r.crm}>신청</SourceCell>
                {canManage && !r.aca && r.itemId && (
                  <button
                    type="button"
                    onClick={() => undoOne(r.itemId as string)}
                    aria-label="전체 명단에서 빼기"
                    title="전체 명단에서 빼기"
                    className="
                      inline-flex items-center justify-center size-8 shrink-0 rounded-md border
                      border-[color:var(--border)] bg-bg-card text-[color:var(--text)]
                      hover:bg-[color:var(--bg-hover)]
                      disabled:opacity-40 disabled:cursor-not-allowed transition-colors
                    "
                  >
                    <Undo2 className="size-4" strokeWidth={1.75} aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {canManage && (
        <p className="lg:col-span-2 text-[12px] text-[color:var(--text-muted)]">
          왼쪽에서 체크한 신청을 &lsquo;전체 명단에 추가&rsquo;로 옮기거나
          &lsquo;삭제&rsquo;로 신청 명단에서 제거할 수 있어요. (삭제해도 기록은
          보존돼 복구 가능합니다.)
        </p>
      )}

      {confirmingDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="signup-delete-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isPending)
              setConfirmingDelete(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !isPending) setConfirmingDelete(false);
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-bg-card border border-[color:var(--border)] shadow-lg p-6 space-y-4">
            <h3
              id="signup-delete-title"
              className="text-[18px] font-semibold text-[color:var(--text)]"
            >
              선택한 신청을 삭제할까요?
            </h3>
            <p className="text-[14px] text-[color:var(--text-muted)] leading-relaxed">
              선택한{" "}
              <span className="font-medium text-[color:var(--text)] tabular-nums">
                {selectedCount}명
              </span>
              의 신청이 명단에서 제거됩니다. 기록은 보존돼 필요하면 복구할 수
              있어요.
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={isPending}
                className="
                  inline-flex items-center h-10 px-4 rounded-lg
                  border border-[color:var(--border)] bg-bg-card
                  text-[14px] text-[color:var(--text)]
                  hover:bg-[color:var(--bg-hover)] disabled:opacity-50 transition-colors
                "
              >
                돌아가기
              </button>
              <button
                type="button"
                onClick={deleteSelected}
                disabled={isPending}
                className="
                  inline-flex items-center gap-1.5 h-10 px-5 rounded-lg
                  bg-[color:var(--danger)] text-white
                  text-[14px] font-medium hover:opacity-90 disabled:opacity-50
                  transition-colors
                "
              >
                {isPending ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 내부 소 컴포넌트 ────────────────────────────────────────

function Panel({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={`${title} ${count}명`}
      className="rounded-xl border border-[color:var(--border)] bg-bg-card overflow-hidden min-w-0"
    >
      <header className="flex items-center gap-2 px-4 py-3 border-b border-[color:var(--border)] bg-[color:var(--bg-muted)]">
        {icon}
        <h3 className="text-[15px] font-semibold text-[color:var(--text)]">
          {title}
        </h3>
        <span className="text-[13px] text-[color:var(--text-muted)] tabular-nums">
          {count.toLocaleString()}명
        </span>
      </header>
      <div className="max-h-[28rem] overflow-y-auto">{children}</div>
    </section>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[12px] font-medium leading-none bg-[color:var(--bg-muted)] text-[color:var(--text-muted)] border border-[color:var(--border)] shrink-0">
      {children}
    </span>
  );
}

/** aca / crm 소속 표시 셀 — 소속이면 채운 배지, 아니면 흐린 점. */
function SourceCell({ on, children }: { on: boolean; children: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center w-12 shrink-0 text-[12px] font-medium rounded-md py-0.5 ${
        on
          ? "bg-[color:var(--text)] text-[color:var(--bg-card)]"
          : "text-[color:var(--text-dim)]"
      }`}
    >
      {on ? children : "·"}
    </span>
  );
}

function EmptyRow({ message }: { message: string }) {
  return (
    <p className="px-4 py-10 text-center text-[14px] text-[color:var(--text-muted)]">
      {message}
    </p>
  );
}

/** "학교 학년" 합친 표기. 둘 다 없으면 "—". */
function formatSchoolGrade(
  school: string | null,
  grade: string | null,
): string {
  const parts = [school, grade].filter((v): v is string => Boolean(v));
  return parts.length > 0 ? parts.join(" ") : "—";
}
