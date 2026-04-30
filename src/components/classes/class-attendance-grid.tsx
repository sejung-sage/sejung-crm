import type {
  AttendanceRow,
  AttendanceStatus,
  ClassStudentRow,
} from "@/types/database";
import { AttendanceStatusChip } from "@/components/students/attendance-status-chip";

type AttendanceMatrixRow = Pick<
  AttendanceRow,
  "id" | "student_id" | "attended_at" | "status" | "aca_class_id"
>;

interface Props {
  students: ClassStudentRow[];
  attendances: AttendanceMatrixRow[];
}

/**
 * 강좌 상세 · 학생 × 일자 출결 격자.
 *
 * 학생 상세의 `student-attendances-panel.tsx` 매트릭스 빌더 로직을 미러링.
 * 단 축이 뒤집힘:
 *   - 기존: row=강좌, col=일자
 *   - 신규: row=학생, col=일자
 *
 * 좌측 sticky:
 *   - 학생 이름 셀
 *   - 카운트 6 칸 (총·출·결·지·조·보)
 * 가로 스크롤로 전 일자(MM/DD) 컬럼을 펼친다.
 *
 * 빈 상태(attendances 없음): 격자 자체를 안 그리고 빈 카드.
 *
 * Server Component — 매트릭스 빌드는 렌더 1회. 학생 30명 × 일자 60 정도면
 * 충분히 가볍다. PostgREST cap 1000 행 도달 시는 loader 가 warn 함.
 */
export function ClassAttendanceGrid({ students, attendances }: Props) {
  if (attendances.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-white py-16 text-center">
        <p className="text-[15px] text-[color:var(--text-muted)]">
          출결 기록이 없습니다.
        </p>
      </div>
    );
  }

  const matrix = buildMatrix(students, attendances);

  // 모든 학생이 출결 0 인 비정상 케이스는 빈 격자가 되므로 빈 상태 처리.
  // (loader 가 attendances 가 0 이 아니면 여기로 오지만, students 는 비어 있을 수 있다.)
  if (matrix.rows.length === 0 || matrix.dates.length === 0) {
    return (
      <div className="rounded-xl border border-[color:var(--border)] bg-white py-16 text-center">
        <p className="text-[15px] text-[color:var(--text-muted)]">
          출결 기록이 없습니다.
        </p>
      </div>
    );
  }

  return (
    <section aria-label="학생별 일자 출결 격자" className="space-y-2">
      <p className="text-[13px] text-[color:var(--text-muted)]">
        학생별 일자 출결. 가로로 스크롤해 전체 기간을 확인할 수 있습니다.
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
                    min-w-[180px]
                  "
                >
                  학생
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
              {matrix.rows.map((r, idx) => (
                <tr
                  key={r.key}
                  className={
                    idx === matrix.rows.length - 1
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
                      {r.title}
                    </div>
                    {r.subtitle && (
                      <div className="mt-0.5 text-[12px] text-[color:var(--text-muted)]">
                        {r.subtitle}
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
                      {r.counts[col.key] || (
                        <span className="text-[color:var(--text-dim)]">·</span>
                      )}
                    </td>
                  ))}
                  {matrix.dates.map((d) => {
                    const status = r.byDate.get(d.iso);
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

// ─── 매트릭스 빌드 ────────────────────────────────────────

interface DateColumn {
  iso: string; // YYYY-MM-DD
  month: string; // "M월"
  day: string; // "D일"
}

interface StudentRow {
  key: string; // student_id
  title: string; // 학생 이름
  subtitle: string | null; // 학교+학년 (없으면 null)
  counts: Record<AttendanceStatus | "총", number>;
  byDate: Map<string, AttendanceStatus>;
}

interface Matrix {
  dates: DateColumn[];
  rows: StudentRow[];
}

const COUNT_COLUMNS: { key: AttendanceStatus | "총"; label: string }[] = [
  { key: "총", label: "총" },
  { key: "출석", label: "출" },
  { key: "결석", label: "결" },
  { key: "지각", label: "지" },
  { key: "조퇴", label: "조" },
  { key: "보강", label: "보" },
];

// 좌측 sticky 컬럼 누적 left offset (학생 180 + 카운트 6 × 44).
// 학생 격자는 학생 이름 셀이 학생 상세의 강좌 셀(220)보다 짧아도 충분.
const COUNT_LEFT_OFFSETS = [
  180,
  180 + 44,
  180 + 44 * 2,
  180 + 44 * 3,
  180 + 44 * 4,
  180 + 44 * 5,
];

function buildMatrix(
  students: ClassStudentRow[],
  attendances: AttendanceMatrixRow[],
): Matrix {
  // 1) distinct 일자 (오름차순).
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

  // 2) student_id × date → status 매트릭스.
  // 같은 (학생, 일자) 에 행이 여러 개면 마지막 값으로 덮어쓰기.
  const byStudent = new Map<string, Map<string, AttendanceStatus>>();
  for (const a of attendances) {
    let dm = byStudent.get(a.student_id);
    if (!dm) {
      dm = new Map<string, AttendanceStatus>();
      byStudent.set(a.student_id, dm);
    }
    dm.set(a.attended_at, a.status);
  }

  // 3) students 의 한글 정렬 순서를 그대로 유지 (loader 가 정렬 보장).
  // 출결 행이 0 인 학생은 격자에서 제외. 학생 명단 패널이 이미 보여주므로
  // 격자에서 비어 있는 row 가 길게 나열되는 것은 정보가치 없음.
  const rows: StudentRow[] = [];
  for (const s of students) {
    const byDate = byStudent.get(s.id) ?? new Map<string, AttendanceStatus>();
    if (byDate.size === 0) continue;

    const subtitleParts: string[] = [];
    if (s.school) subtitleParts.push(s.school);
    if (s.grade) subtitleParts.push(s.grade);

    rows.push({
      key: s.id,
      title: s.name,
      subtitle: subtitleParts.length > 0 ? subtitleParts.join(" · ") : null,
      counts: {
        총: s.total_count,
        출석: s.attended_count,
        결석: s.absent_count,
        지각: s.late_count,
        조퇴: s.early_leave_count,
        보강: s.makeup_count,
      },
      byDate,
    });
  }

  return { dates, rows };
}
