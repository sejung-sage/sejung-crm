import type { ClassRow } from "@/types/database";
import { BranchBadge } from "@/components/groups/branch-badge";

interface Props {
  cls: ClassRow;
}

/**
 * 강좌 상세 상단 헤더.
 *
 * 학생 상세의 `student-profile-header.tsx` 패턴 미러 — 흰 카드, radius-xl,
 * 좌측 타이틀+메타, 우측 액션. 강좌에는 액션이 없어 우측은 비움.
 *
 * 메타 표시 규약:
 *  - 분원 배지 + (과목/강사) inline (값이 있는 것만)
 *  - 요일·시간 한 줄 (둘 다 있으면 한 줄에 붙여서)
 *  - 정원 / 총회차×회당단가=정가 (있는 것만 채워서)
 */
export function ClassDetailHeader({ cls }: Props) {
  // 과목 · 강사 inline 메타.
  const subjectTeacherParts: string[] = [];
  if (cls.subject) {
    subjectTeacherParts.push(cls.subject);
  } else if (cls.subject_raw) {
    subjectTeacherParts.push(cls.subject_raw);
  }
  if (cls.teacher_name) subjectTeacherParts.push(`${cls.teacher_name} 선생님`);

  // 요일·시간 한 줄.
  const scheduleParts: string[] = [];
  if (cls.schedule_days) scheduleParts.push(cls.schedule_days);
  if (cls.schedule_time) scheduleParts.push(cls.schedule_time);
  const scheduleLine = scheduleParts.length > 0 ? scheduleParts.join(" ") : null;

  // 개강일 — DATE("YYYY-MM-DD") 그대로 노출. 백필 미적용 강좌 (~15%) 는 "—".
  const startDateLine = cls.start_date ?? "—";

  // 정원.
  const capacityLine = cls.capacity != null ? `정원 ${cls.capacity}명` : null;

  // 회차/단가/정가 — 있는 것만 채워서 표시.
  const pricingLine = formatPricing(cls);

  // 강의실.
  const classroomLine = cls.classroom ? `강의실 ${cls.classroom}` : null;

  return (
    <section
      className="rounded-xl border border-[color:var(--border)] bg-white p-6"
      aria-label="강좌 정보"
    >
      <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[28px] font-semibold leading-tight text-[color:var(--text)]">
              {cls.name}
            </h1>
            <BranchBadge branch={cls.branch} />
            {!cls.active && (
              <span
                className="
                  inline-flex items-center px-2 py-0.5 rounded-md
                  text-[12px] font-medium
                  bg-[color:var(--bg-muted)] text-[color:var(--text-muted)]
                  border border-[color:var(--border)]
                "
                title="V_class_list.미사용반구분 = Y"
              >
                미사용
              </span>
            )}
          </div>

          {subjectTeacherParts.length > 0 && (
            <p className="text-[14px] text-[color:var(--text-muted)]">
              {subjectTeacherParts.join(" · ")}
            </p>
          )}

          <dl className="grid grid-cols-1 gap-x-8 gap-y-1.5 pt-1 sm:grid-cols-2">
            {scheduleLine && (
              <MetaRow label="요일·시간" value={scheduleLine} />
            )}
            <MetaRow label="개강일" value={startDateLine} />
            {capacityLine && <MetaRow label="정원" value={capacityLine} />}
            {pricingLine && <MetaRow label="회차·단가" value={pricingLine} />}
            {classroomLine && (
              <MetaRow label="강의실" value={classroomLine} />
            )}
          </dl>
        </div>
      </div>
    </section>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="shrink-0 text-[13px] font-medium text-[color:var(--text-muted)] w-20">
        {label}
      </dt>
      <dd className="text-[14px] text-[color:var(--text)] tabular-nums">
        {value}
      </dd>
    </div>
  );
}

/**
 * 회차·단가·정가를 "8회 × 72,500원 = 580,000원" 형태로.
 * 셋 모두 NULL/0 이면 null 반환 (메타 줄에서 생략).
 * 일부만 있으면 있는 부분만 표시.
 */
function formatPricing(cls: ClassRow): string | null {
  const sessions = cls.total_sessions;
  const perSession = cls.amount_per_session;
  const total = cls.total_amount;

  const hasSessions = sessions !== null && sessions !== undefined && sessions > 0;
  const hasPer = perSession !== null && perSession !== undefined && perSession > 0;
  const hasTotal = total !== null && total !== undefined && total > 0;

  if (!hasSessions && !hasPer && !hasTotal) return null;

  const parts: string[] = [];
  if (hasSessions) parts.push(`${formatSessions(sessions)}회`);
  if (hasSessions && hasPer) parts.push(" × ");
  if (hasPer) parts.push(`${perSession.toLocaleString("ko-KR")}원`);
  if ((hasSessions || hasPer) && hasTotal) parts.push(" = ");
  if (hasTotal) parts.push(`${total.toLocaleString("ko-KR")}원`);

  return parts.join("").trim();
}

function formatSessions(v: number): string {
  if (Number.isInteger(v)) return v.toString();
  return v.toFixed(1);
}
