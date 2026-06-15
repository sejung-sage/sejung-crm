import { useMemo } from "react";
import { Link2, GraduationCap } from "lucide-react";
import type { ClassStudentRow } from "@/types/database";
import type { ClassSignupParentRow } from "@/lib/seminars/get-class-signup-page";
import { formatPhone } from "@/lib/phone";
import { formatKstDateTime } from "@/lib/datetime";

interface Props {
  /** 아카에 등록된 수강생 (crm_classes ↔ enrollments). */
  acaStudents: ClassStudentRow[];
  /** CRM 공개 신청 페이지에서 신청 완료(signed)한 학부모/학생. */
  crmSignups: ClassSignupParentRow[];
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

/**
 * 설명회 상세 명단 (읽기 전용).
 *  - 좌: CRM 신청생 (공개 신청 페이지로 신청 완료한 신규).
 *  - 우: 전체 데이터 (아카 ∪ CRM, student_id 중복 제거) + 아카/신청 출처 표시.
 *
 * 신규 신청자는 자동으로 전체 데이터에 합쳐진다. (수동 삭제/제외는 제공하지 않는다
 * — 실수 삭제 방지.)
 */
export function SeminarRosterPanels({ acaStudents, crmSignups }: Props) {
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      {/* 좌 — CRM 신청생 (신규) */}
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
            {crmSignups.map((p) => (
              <li
                key={p.item_id}
                className="flex items-center gap-3 px-4 py-2.5"
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
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* 우 — 전체 데이터 (아카 ∪ CRM) */}
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
              </li>
            ))}
          </ul>
        )}
      </Panel>
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
