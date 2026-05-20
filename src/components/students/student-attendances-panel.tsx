import type {
  AttendanceStatus,
  AttendanceWithClass,
  ExpectedSession,
} from "@/types/database";
import { AttendanceStatusChip } from "@/components/students/attendance-status-chip";

interface Props {
  // 호출 측에서 attended_at DESC 로 정렬되어 들어오지만,
  // 강좌별 mini timeline 은 과거→최근 오름차순으로 펼쳐야 가독성이 좋다.
  attendances: AttendanceWithClass[];
  /**
   * 결제완료 ticket 의 강좌×예정 회차. 비-방배 분원에서만 비어있지 않음.
   * column 펼침 기준 = attendance.attended_at ∪ expectedSessions.class_date
   * → "결제 8회 = column 8개" 진척도 표시.
   */
  expectedSessions?: ExpectedSession[];
  /**
   * 학생 분원. "방배" 면 chip 이 5종 raw 표시, 그 외이면 결석 외 모두 출석 chip
   * (`attendance-policy` 단일 정책).
   */
  branch?: string | null;
}

/**
 * 학생 상세 · 출석 패널 (강좌별 accordion).
 *
 * 강좌마다 collapsible card 한 줄 + 펼치면 그 강좌의 자기 일자만 column 으로
 * 펼쳐지는 mini timeline.
 *
 * 이전 디자인(0061~) 은 강좌 × 학생전체일자 단일 격자였는데, 강좌별 회차가
 * 6~29건인데도 column 이 100+개 펼쳐져 빈 cell(·) 가 압도적이었다.
 * 0062 부터 강좌별 accordion 으로 분해 — 각 강좌가 자기 일자만 보여줘
 * 빈 cell 이 사라진다.
 *
 * `<details>` 요소 사용 — 키보드 접근성·스크린리더·CSS open state 모두 무료.
 * Server Component (상태 없음).
 */
export function StudentAttendancesPanel({
  attendances,
  expectedSessions = [],
  branch,
}: Props) {
  if (attendances.length === 0 && expectedSessions.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-bg-card py-16 text-center">
        <p className="text-[15px] text-[color:var(--text-muted)]">
          출석 기록이 없습니다.
        </p>
      </div>
    );
  }

  const groups = buildGroups(attendances, expectedSessions);

  return (
    <section aria-label="출석 (강좌별)" className="space-y-3">
      <p className="text-[13px] text-[color:var(--text-muted)]">
        강좌를 클릭하면 그 강좌의 일자별 출결을 펼쳐서 확인할 수 있습니다.
      </p>

      <ul className="space-y-2">
        {groups.map((g) => (
          <li key={g.key}>
            <CourseAccordion group={g} branch={branch} />
          </li>
        ))}
      </ul>

      <p className="text-[12px] text-[color:var(--text-muted)]">
        칩 — 출(출석) · 보(보강) · 지(지각) · 결(결석) · 조(조퇴). 보강은
        출석률 인정.
      </p>
    </section>
  );
}

// ─── 강좌 accordion ───────────────────────────────────────

function CourseAccordion({
  group,
  branch,
}: {
  group: GroupRow;
  branch?: string | null;
}) {
  // column dates = attendance row 일자 ∪ 결제완료 ticket 의 class_date.
  // expectedDates 가 비어있으면 (방배 등) attendance row 만 펼쳐짐.
  const dates = Array.from(
    new Set<string>([
      ...group.byDate.keys(),
      ...group.expectedDates,
    ]),
  ).sort();

  return (
    <details className="group rounded-xl border border-[color:var(--border)] bg-bg-card overflow-hidden">
      <summary
        className="
          list-none cursor-pointer select-none
          flex items-center gap-3 px-4 py-3
          hover:bg-[color:var(--bg-muted)]
          focus-visible:outline-none focus-visible:bg-[color:var(--bg-muted)]
        "
      >
        {/* 좌측: 강좌 메타 */}
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium text-[color:var(--text)] truncate">
            {group.title}
          </div>
          {group.subtitle && (
            <div className="mt-0.5 text-[12px] text-[color:var(--text-muted)] truncate">
              {group.subtitle}
            </div>
          )}
          {group.note && (
            <div className="mt-0.5 text-[12px] text-[color:var(--text-dim)] truncate">
              {group.note}
            </div>
          )}
        </div>

        {/* 카운트 chip 묶음 */}
        <div className="flex items-center gap-3 text-[12px] tabular-nums whitespace-nowrap">
          {COUNT_COLUMNS.map((col) => {
            const v = group.counts[col.key];
            const dim = v === 0;
            return (
              <span
                key={col.key}
                className={
                  dim
                    ? "text-[color:var(--text-dim)]"
                    : "text-[color:var(--text)]"
                }
                aria-label={`${col.aria} ${v}`}
              >
                <span className="text-[color:var(--text-muted)]">
                  {col.label}
                </span>{" "}
                {v}
              </span>
            );
          })}
        </div>

        {/* 토글 아이콘 — open 시 회전 */}
        <ChevronIcon className="shrink-0 text-[color:var(--text-muted)] transition-transform group-open:rotate-180" />
      </summary>

      {/* 펼친 영역 — 이 강좌의 일자만 column */}
      <div className="border-t border-[color:var(--border)]">
        <div className="overflow-x-auto">
          <table className="border-collapse text-[14px]">
            <thead>
              <tr>
                {dates.map((iso) => {
                  const [, m, d] = iso.split("-");
                  return (
                    <th
                      key={iso}
                      scope="col"
                      className="
                        px-1 py-3 text-center text-[12px] font-medium
                        text-[color:var(--text-muted)] tabular-nums
                        whitespace-nowrap min-w-[44px]
                      "
                      title={iso}
                    >
                      <span className="block leading-tight">
                        {Number(m)}월
                      </span>
                      <span className="block leading-tight">
                        {Number(d)}일
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              <tr>
                {dates.map((iso) => {
                  const status = group.byDate.get(iso);
                  return (
                    <td
                      key={iso}
                      className="px-1 py-3 text-center align-middle"
                    >
                      {status ? (
                        <AttendanceStatusChip
                          status={status}
                          branch={branch}
                        />
                      ) : (
                        // 결제는 했으나 attendance row 없는 회차 — 빈 점.
                        <span
                          className="text-[color:var(--text-dim)]"
                          aria-label="예정 회차 (출결 미기록)"
                          title="예정 회차"
                        >
                          ·
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

// ─── 그룹 빌드 ────────────────────────────────────────────

interface GroupRow {
  key: string; // aca_class_id 또는 "__unmatched__"
  title: string;
  subtitle: string | null;
  note: string | null;
  counts: Record<AttendanceStatus | "총", number>;
  byDate: Map<string, AttendanceStatus>;
  /**
   * 이 강좌의 결제완료 ticket 예정 회차 일자 (YYYY-MM-DD).
   * column 펼침 시 byDate.keys() 와 union. 비-방배 + ticket 있는 경우만 채워짐.
   */
  expectedDates: Set<string>;
}

const UNMATCHED_KEY = "__unmatched__";

const COUNT_COLUMNS: {
  key: AttendanceStatus | "총";
  label: string;
  aria: string;
}[] = [
  { key: "총", label: "총", aria: "총" },
  { key: "출석", label: "출", aria: "출석" },
  { key: "결석", label: "결", aria: "결석" },
  { key: "지각", label: "지", aria: "지각" },
  { key: "조퇴", label: "조", aria: "조퇴" },
  { key: "보강", label: "보", aria: "보강" },
];

function buildGroups(
  attendances: AttendanceWithClass[],
  expectedSessions: ExpectedSession[],
): GroupRow[] {
  const groupMap = new Map<string, GroupRow>();
  for (const a of attendances) {
    const key = a.aca_class_id ?? UNMATCHED_KEY;
    let g = groupMap.get(key);
    if (!g) {
      g = {
        key,
        ...buildGroupHeader(a),
        counts: { 총: 0, 출석: 0, 지각: 0, 결석: 0, 조퇴: 0, 보강: 0 },
        byDate: new Map<string, AttendanceStatus>(),
        expectedDates: new Set<string>(),
      };
      groupMap.set(key, g);
    }
    // 동일 (강좌, 일자) row 가 두 개 이상인 비정상 케이스는 마지막 값 유지.
    g.byDate.set(a.attended_at, a.status);
    g.counts[a.status] += 1;
    g.counts["총"] += 1;
  }

  // expectedSessions 머지 — attendance 가 한 건도 없는 강좌도 그룹 생성.
  // 그 경우 group header 는 강좌 마스터 fallback (이름 없으면 ID slice).
  for (const s of expectedSessions) {
    const key = s.aca_class_id;
    let g = groupMap.get(key);
    if (!g) {
      // attendance 0건 + ticket 만 있는 강좌. class lookup 이 없으니
      // placeholder header — 사용자 보고용으론 "강좌 #xxxxxxxx" 로 표시됨.
      g = {
        key,
        title: `강좌 #${key.slice(-8)}`,
        subtitle: null,
        note: "(출결 0건 · 예정 회차만)",
        counts: { 총: 0, 출석: 0, 지각: 0, 결석: 0, 조퇴: 0, 보강: 0 },
        byDate: new Map<string, AttendanceStatus>(),
        expectedDates: new Set<string>(),
      };
      groupMap.set(key, g);
    }
    g.expectedDates.add(s.class_date);
  }

  // 정렬 — 총 카운트 DESC, 같으면 강좌명 ko 정렬. unmatched 는 맨 아래.
  return Array.from(groupMap.values()).sort((a, b) => {
    if (a.key === UNMATCHED_KEY) return 1;
    if (b.key === UNMATCHED_KEY) return -1;
    const dt = b.counts["총"] - a.counts["총"];
    if (dt !== 0) return dt;
    return a.title.localeCompare(b.title, "ko");
  });
}

function buildGroupHeader(a: AttendanceWithClass): {
  title: string;
  subtitle: string | null;
  note: string | null;
} {
  if (!a.aca_class_id) {
    return {
      title: "강좌 미매칭",
      subtitle: null,
      note: "출결에 강좌 정보가 없는 항목",
    };
  }
  if (!a.class) {
    return {
      title: `강좌 #${a.aca_class_id.slice(-8)}`,
      subtitle: null,
      note: "(강좌 마스터 미동기)",
    };
  }
  const c = a.class;
  const subtitleParts: string[] = [];
  if (c.teacher_name) subtitleParts.push(`${c.teacher_name} 선생님`);
  const sched = [c.schedule_days, c.schedule_time].filter(Boolean).join(" ");
  if (sched) subtitleParts.push(sched);
  return {
    title: c.name,
    subtitle: subtitleParts.length > 0 ? subtitleParts.join(" · ") : null,
    note: null,
  };
}
