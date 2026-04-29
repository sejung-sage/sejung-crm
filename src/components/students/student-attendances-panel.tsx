import type {
  AttendanceStatus,
  AttendanceWithClass,
} from "@/types/database";

interface Props {
  // 호출 측에서 attended_at DESC 로 정렬되어 들어오지만,
  // 격자 컬럼은 과거→최근 오름차순으로 펼쳐야 가독성이 좋다.
  attendances: AttendanceWithClass[];
}

/**
 * 학생 상세 · 출석 패널 (강좌 × 일자 격자).
 *
 * Aca2000 의 학생별 출결 화면과 동일한 정보를 흰+검정 미니멀 톤으로 재현.
 * - 좌측 고정: 강좌 메타 + 카운트 요약 (총·출·결·지·조·보)
 * - 우측 가로 스크롤: 학생 전체 출결의 distinct 일자 (과거→최근)
 * - 각 셀은 (강좌 × 일자) 매트릭스에 row 가 있으면 상태 칩, 없으면 공란
 *
 * Server Component — group by/matrix 빌드는 렌더 1회.
 * 한 학생 attendances 가 1000행, 일자 distinct 100~200 정도여도 충분.
 */
export function StudentAttendancesPanel({ attendances }: Props) {
  if (attendances.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-white py-16 text-center">
        <p className="text-[15px] text-[color:var(--text-muted)]">
          출석 기록이 없습니다.
        </p>
      </div>
    );
  }

  const matrix = buildMatrix(attendances);

  return (
    <section aria-label="출석 격자" className="space-y-2">
      <p className="text-[13px] text-[color:var(--text-muted)]">
        강좌별 일자 출결. 가로로 스크롤해 전체 기간을 확인할 수 있습니다.
      </p>

      <div className="rounded-xl border border-[color:var(--border)] bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="border-collapse text-[14px]">
            <thead>
              <tr className="bg-[color:var(--bg-muted)]">
                <th
                  scope="col"
                  className="
                    sticky left-0 z-20 bg-[color:var(--bg-muted)]
                    px-4 py-3 text-left text-[13px] font-medium
                    text-[color:var(--text-muted)] tracking-wide
                    border-b border-r border-[color:var(--border)]
                    min-w-[220px]
                  "
                >
                  강좌
                </th>
                {COUNT_COLUMNS.map((col, i) => (
                  <th
                    key={col.key}
                    scope="col"
                    className={`
                      sticky z-20 bg-[color:var(--bg-muted)]
                      px-2 py-3 text-center text-[12px] font-medium
                      text-[color:var(--text-muted)]
                      border-b border-[color:var(--border)]
                      ${i === COUNT_COLUMNS.length - 1 ? "border-r" : ""}
                      w-[44px] min-w-[44px]
                    `}
                    style={{ left: COUNT_LEFT_OFFSETS[i] }}
                  >
                    {col.label}
                  </th>
                ))}
                {matrix.dates.map((d) => (
                  <th
                    key={d.iso}
                    scope="col"
                    className="
                      px-1 py-3 text-center text-[12px] font-medium
                      text-[color:var(--text-muted)] tabular-nums
                      border-b border-[color:var(--border)]
                      whitespace-nowrap min-w-[44px]
                    "
                    title={d.iso}
                  >
                    <span className="block leading-tight">{d.month}</span>
                    <span className="block leading-tight">{d.day}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.groups.map((g, idx) => (
                <tr
                  key={g.key}
                  className={
                    idx === matrix.groups.length - 1
                      ? ""
                      : "border-b border-[color:var(--border)]"
                  }
                >
                  <th
                    scope="row"
                    className="
                      sticky left-0 z-10 bg-white
                      px-4 py-3 text-left
                      border-r border-[color:var(--border)]
                      align-top
                    "
                  >
                    <div className="text-[14px] font-medium text-[color:var(--text)]">
                      {g.title}
                    </div>
                    {g.subtitle && (
                      <div className="mt-0.5 text-[12px] text-[color:var(--text-muted)]">
                        {g.subtitle}
                      </div>
                    )}
                    {g.note && (
                      <div className="mt-0.5 text-[12px] text-[color:var(--text-dim)]">
                        {g.note}
                      </div>
                    )}
                  </th>
                  {COUNT_COLUMNS.map((col, i) => (
                    <td
                      key={col.key}
                      className={`
                        sticky z-10 bg-white
                        px-2 py-3 text-center text-[13px] tabular-nums
                        text-[color:var(--text)]
                        ${i === COUNT_COLUMNS.length - 1 ? "border-r border-[color:var(--border)]" : ""}
                      `}
                      style={{ left: COUNT_LEFT_OFFSETS[i] }}
                    >
                      {g.counts[col.key] || (
                        <span className="text-[color:var(--text-dim)]">·</span>
                      )}
                    </td>
                  ))}
                  {matrix.dates.map((d) => {
                    const status = g.byDate.get(d.iso);
                    return (
                      <td
                        key={d.iso}
                        className="px-1 py-2 text-center align-middle"
                      >
                        {status ? (
                          <AttendanceStatusChip status={status} />
                        ) : (
                          <span
                            className="text-[color:var(--text-dim)]"
                            aria-label="기록 없음"
                          >
                            ·
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[12px] text-[color:var(--text-muted)]">
        칩 — 출(출석) · 보(보강) · 지(지각) · 결(결석) · 조(조퇴). 보강은
        출석률 인정.
      </p>
    </section>
  );
}

// ─── 상태 칩 ──────────────────────────────────────────────

interface ChipStyle {
  label: string;
  cls: string;
}

const STATUS_CHIP: Record<AttendanceStatus, ChipStyle> = {
  출석: {
    label: "출",
    cls: "bg-emerald-50 text-emerald-700 border-emerald-100",
  },
  보강: {
    label: "보",
    cls: "bg-sky-50 text-sky-700 border-sky-100",
  },
  지각: {
    label: "지",
    cls: "bg-amber-50 text-amber-700 border-amber-100",
  },
  결석: {
    label: "결",
    cls: "bg-rose-50 text-rose-700 border-rose-100",
  },
  조퇴: {
    label: "조",
    cls: "bg-slate-100 text-slate-600 border-slate-200",
  },
};

function AttendanceStatusChip({ status }: { status: AttendanceStatus }) {
  const s = STATUS_CHIP[status];
  return (
    <span
      aria-label={status}
      className={`
        inline-flex items-center justify-center
        w-7 h-6 rounded border
        text-[12px] font-medium tabular-nums
        ${s.cls}
      `}
    >
      <span aria-hidden>{s.label}</span>
    </span>
  );
}

// ─── 매트릭스 빌드 ────────────────────────────────────────

interface DateColumn {
  iso: string; // YYYY-MM-DD
  month: string; // MM
  day: string; // DD
}

interface GroupRow {
  key: string; // aca_class_id 또는 "__unmatched__"
  title: string;
  subtitle: string | null;
  note: string | null;
  counts: Record<AttendanceStatus | "총", number>;
  byDate: Map<string, AttendanceStatus>;
}

interface Matrix {
  dates: DateColumn[];
  groups: GroupRow[];
}

const UNMATCHED_KEY = "__unmatched__";

const COUNT_COLUMNS: { key: AttendanceStatus | "총"; label: string }[] = [
  { key: "총", label: "총" },
  { key: "출석", label: "출" },
  { key: "결석", label: "결" },
  { key: "지각", label: "지" },
  { key: "조퇴", label: "조" },
  { key: "보강", label: "보" },
];

// 좌측 sticky 컬럼들의 누적 left offset (강좌 220 + 카운트 6 × 44).
// CSS sticky 는 left 값으로 누적 위치를 잡아줘야 하므로 px 로 직접 계산.
const COUNT_LEFT_OFFSETS = [
  220,
  220 + 44,
  220 + 44 * 2,
  220 + 44 * 3,
  220 + 44 * 4,
  220 + 44 * 5,
];

function buildMatrix(attendances: AttendanceWithClass[]): Matrix {
  // 1) distinct 일자 (오름차순)
  const dateSet = new Set<string>();
  for (const a of attendances) {
    if (a.attended_at) dateSet.add(a.attended_at);
  }
  const dates: DateColumn[] = Array.from(dateSet)
    .sort()
    .map((iso) => {
      const [, m, d] = iso.split("-");
      return { iso, month: `${Number(m)}월`, day: `${Number(d)}일` };
    });

  // 2) group by aca_class_id
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
      };
      groupMap.set(key, g);
    }
    // 동일 (강좌, 일자) 에 row 가 두 개 이상인 비정상 케이스는 마지막 값 유지.
    // 원본 정렬이 attended_at DESC + created_at 이라 같은 날 여러 row 면
    // 가장 최근 created 가 먼저 처리되고, 이후 덮어쓰기 = 가장 오래된 created 가 남음.
    // 이 패널 목적상 한 셀에 어떤 상태든 보이면 충분하므로 단순 덮어쓰기.
    g.byDate.set(a.attended_at, a.status);
    g.counts[a.status] += 1;
    g.counts["총"] += 1;
  }

  // 3) 그룹 정렬 — 매칭된 강좌(이름순) 먼저, "강좌 미매칭" 마지막
  const groups = Array.from(groupMap.values()).sort((a, b) => {
    if (a.key === UNMATCHED_KEY) return 1;
    if (b.key === UNMATCHED_KEY) return -1;
    return a.title.localeCompare(b.title, "ko");
  });

  return { dates, groups };
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
