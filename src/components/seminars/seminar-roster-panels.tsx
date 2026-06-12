"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, GraduationCap, ArrowRight, Loader2 } from "lucide-react";
import type { ClassStudentRow } from "@/types/database";
import type { ClassSignupParentRow } from "@/lib/seminars/get-class-signup-page";
import { formatPhone } from "@/lib/phone";
import { formatKstDateTime } from "@/lib/datetime";
import { cancelSignupAction } from "@/app/(features)/seminars/actions";
import { useToast } from "@/components/ui/toast";

interface Props {
  /** 아카에 등록된 수강생 (crm_classes ↔ enrollments). */
  acaStudents: ClassStudentRow[];
  /** CRM 공개 신청 페이지에서 신청 완료(signed)한 학부모/학생. */
  crmSignups: ClassSignupParentRow[];
  /** 운영자 수동 편집 권한(write/group). false 면 보기 전용. */
  canManage: boolean;
}

/** 전체 데이터 한 행 — 아카·CRM 합집합(중복 제거). */
interface UnionRow {
  id: string;
  name: string;
  school: string | null;
  grade: string | null;
  aca: boolean;
  crm: boolean;
}

/** 선택된 CRM 신청생 (제외 대상). */
type Selected = { id: string; itemId: string } | null;

/**
 * 설명회 상세 명단 — 좌: CRM 신청생 / 우: 전체 데이터(아카 ∪ CRM, aca·crm 컬럼).
 *
 * 운영자(canManage)는 CRM 신청생을 선택하고 ▶ 로 신청 명단에서 제외할 수 있다
 * (cancelSignupAction). 제외하면 그 학생은 CRM 신청생에서 빠지고 전체 데이터에만
 * 남는다(아카 등록이면). 수동 추가는 제공하지 않는다 — 실제 신청만 명단에 든다.
 */
export function SeminarRosterPanels({
  acaStudents,
  crmSignups,
  canManage,
}: Props) {
  const router = useRouter();
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Selected>(null);

  const signupStudentIds = useMemo(
    () => new Set(crmSignups.map((p) => p.student_id)),
    [crmSignups],
  );
  const acaStudentIds = useMemo(
    () => new Set(acaStudents.map((s) => s.id)),
    [acaStudents],
  );

  // 전체 데이터 = 아카 ∪ CRM (student id 기준 dedupe), 이름 오름차순.
  const allRows: UnionRow[] = useMemo(() => {
    const map = new Map<string, UnionRow>();
    for (const s of acaStudents) {
      map.set(s.id, {
        id: s.id,
        name: s.name,
        school: s.school,
        grade: s.grade ? String(s.grade) : null,
        aca: true,
        crm: signupStudentIds.has(s.id),
      });
    }
    for (const p of crmSignups) {
      const ex = map.get(p.student_id);
      if (ex) {
        ex.crm = true;
      } else {
        map.set(p.student_id, {
          id: p.student_id,
          name: p.student_name,
          school: p.school,
          grade: p.grade,
          aca: acaStudentIds.has(p.student_id),
          crm: true,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "ko"),
    );
  }, [acaStudents, crmSignups, signupStudentIds, acaStudentIds]);

  const canRemove = canManage && selected !== null;

  const doRemove = () => {
    if (!canRemove || !selected) return;
    const itemId = selected.itemId;
    startTransition(async () => {
      const r = await cancelSignupAction({ signup_id: itemId });
      if (r.status === "success") {
        show("success", "신청 명단에서 제외했습니다.");
        setSelected(null);
        router.refresh();
      } else if (r.status === "dev_seed_mode") {
        show("error", "개발 시드 모드라 반영되지 않습니다.");
      } else {
        show("error", r.reason);
      }
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-4 items-start">
      {/* 좌 — CRM 신청생 (선택 → ▶ 로 제외) */}
      <Panel
        icon={
          <Link2
            className="size-4 text-[color:var(--text-muted)]"
            strokeWidth={1.75}
            aria-hidden
          />
        }
        title="CRM 신청생"
        count={crmSignups.length}
      >
        {crmSignups.length === 0 ? (
          <EmptyRow message="아직 신청한 학부모가 없습니다." />
        ) : (
          <ul className="divide-y divide-[color:var(--border)]">
            {crmSignups.map((p) => {
              const isSel = selected?.itemId === p.item_id;
              return (
                <Row
                  key={p.item_id}
                  selectable={canManage}
                  selected={isSel}
                  onSelect={() =>
                    setSelected({ id: p.student_id, itemId: p.item_id })
                  }
                >
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
                </Row>
              );
            })}
          </ul>
        )}
      </Panel>

      {/* 중앙 — 제외 화살표 (CRM 신청생 → 전체 데이터). 운영자만. */}
      {canManage && (
        <div className="flex items-center justify-center lg:self-center py-1">
          <ArrowBtn
            label="선택한 신청생을 신청 명단에서 제외"
            disabled={!canRemove || isPending}
            busy={isPending}
            onClick={doRemove}
          />
        </div>
      )}

      {/* 우 — 전체 데이터 (아카 ∪ CRM, aca·crm 컬럼). 보기 전용. */}
      <Panel
        icon={
          <GraduationCap
            className="size-4 text-[color:var(--text-muted)]"
            strokeWidth={1.75}
            aria-hidden
          />
        }
        title="전체 데이터"
        count={allRows.length}
      >
        {allRows.length === 0 ? (
          <EmptyRow message="명단이 비어 있습니다." />
        ) : (
          <ul className="divide-y divide-[color:var(--border)]">
            {allRows.map((r) => (
              <Row key={r.id} selectable={false} selected={false} onSelect={() => {}}>
                <span className="font-medium text-[15px] text-[color:var(--text)] truncate">
                  {r.name}
                </span>
                <span className="text-[13px] text-[color:var(--text-muted)] truncate">
                  {formatSchoolGrade(r.school, r.grade)}
                </span>
                <div className="flex-1" />
                <SourceCell on={r.aca}>아카</SourceCell>
                <SourceCell on={r.crm}>신청</SourceCell>
              </Row>
            ))}
          </ul>
        )}
      </Panel>

      {canManage && (
        <p className="lg:col-span-3 text-[12px] text-[color:var(--text-muted)]">
          CRM 신청생을 선택하고 ▶ 로 신청 명단에서 제외할 수 있습니다. (제외해도
          전체 데이터에는 남습니다.)
        </p>
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

/** 선택 가능한 명단 행. selectable=false 면 일반 표시(클릭 무반응). */
function Row({
  selectable,
  selected,
  onSelect,
  children,
}: {
  selectable: boolean;
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  const base = "flex items-center gap-3 px-4 py-2.5";
  if (!selectable) return <li className={base}>{children}</li>;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`${base} w-full text-left transition-colors ${
          selected
            ? "bg-[color:var(--bg-muted)] ring-1 ring-inset ring-[color:var(--action)]"
            : "hover:bg-[color:var(--bg-hover)]"
        }`}
      >
        {children}
      </button>
    </li>
  );
}

function ArrowBtn({
  label,
  disabled,
  busy,
  onClick,
}: {
  label: string;
  disabled: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  const Icon = busy ? Loader2 : ArrowRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="
        inline-flex items-center justify-center size-10 rounded-lg border
        border-[color:var(--border)] bg-bg-card text-[color:var(--text)]
        hover:bg-[color:var(--bg-hover)]
        disabled:opacity-40 disabled:cursor-not-allowed
        transition-colors
      "
    >
      <Icon
        className={`size-5 ${busy ? "animate-spin" : ""}`}
        strokeWidth={1.75}
        aria-hidden
      />
    </button>
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
