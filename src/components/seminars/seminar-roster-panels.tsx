import Link from "next/link";
import { Link2, GraduationCap } from "lucide-react";
import type { ClassStudentRow } from "@/types/database";
import type { ClassSignupParentRow } from "@/lib/seminars/get-class-signup-page";
import { formatPhone, maskPhone } from "@/lib/phone";
import { formatKstDateTime } from "@/lib/datetime";

interface Props {
  /** 아카에 등록된 수강생 (crm_classes ↔ enrollments). */
  acaStudents: ClassStudentRow[];
  /** CRM 공개 신청 페이지에서 신청 완료(signed)한 학부모/학생. */
  crmSignups: ClassSignupParentRow[];
  /** 학부모 연락처 풀 노출 권한. master 만 true. */
  canRevealPhone: boolean;
}

/**
 * 설명회 상세의 명단 2패널.
 *
 * 설명회는 두 출처의 명단이 섞인다:
 *  A) CRM 신청생 — 공개 신청 페이지로 직접 신청한 학부모 (signed items)
 *  B) 아카 등록 수강생 — 강좌(crm_classes)에 enrollments 로 묶인 학생
 *
 * 운영자는 "초대했는데 안 온 사람 / 신청은 했는데 아카엔 없는 사람" 을 비교해야
 * 하므로, student_id 기준으로 두 집합의 교집합을 계산해 각 패널에 교차 뱃지를
 * 단다. (Set 기반 O(n) 판정)
 *
 * 정렬은 두 입력 모두 이미 적절히 정렬돼 들어오므로 입력 순서를 유지한다.
 */
export function SeminarRosterPanels({
  acaStudents,
  crmSignups,
  canRevealPhone,
}: Props) {
  // 교집합 판정용 Set — 양방향.
  const acaStudentIds = new Set(acaStudents.map((s) => s.id));
  const signupStudentIds = new Set(crmSignups.map((p) => p.student_id));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* 패널 A — CRM 신청생 */}
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
                {acaStudentIds.has(p.student_id) && (
                  <Badge>아카에도 등록</Badge>
                )}
                <span className="text-[13px] text-[color:var(--text-muted)] tabular-nums">
                  {p.parent_phone
                    ? canRevealPhone
                      ? formatPhone(p.parent_phone) || "—"
                      : maskPhone(p.parent_phone)
                    : "—"}
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

      {/* 패널 B — 아카 등록 수강생 */}
      <Panel
        icon={
          <GraduationCap
            className="size-4 text-[color:var(--text-muted)]"
            strokeWidth={1.75}
            aria-hidden
          />
        }
        title="아카 등록 수강생"
        count={acaStudents.length}
      >
        {acaStudents.length === 0 ? (
          <EmptyRow message="아카 등록 수강생이 없습니다." />
        ) : (
          <ul className="divide-y divide-[color:var(--border)]">
            {acaStudents.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                <Link
                  href={`/students/${s.id}`}
                  className="font-medium text-[15px] text-[color:var(--text)] truncate hover:underline"
                >
                  {s.name}
                </Link>
                {signupStudentIds.has(s.id) && <Badge>신청함</Badge>}
                <span className="text-[13px] text-[color:var(--text-muted)] truncate">
                  {formatSchoolGrade(s.school, s.grade)}
                </span>
                <div className="flex-1" />
                <span className="text-[13px] text-[color:var(--text)] tabular-nums shrink-0">
                  출석 {s.attended_count}/{s.total_count}
                </span>
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
      className="rounded-xl border border-[color:var(--border)] bg-bg-card overflow-hidden"
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
      {children}
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
