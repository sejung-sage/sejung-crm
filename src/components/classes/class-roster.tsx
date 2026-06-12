"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Send } from "lucide-react";
import type { ClassStudentRow } from "@/types/database";
import type { ClassSessionsResult } from "@/lib/classes/get-class-sessions";
import { formatPhone, maskPhone } from "@/lib/phone";
import { ClassSendModal } from "@/components/classes/class-send-modal";

interface Props {
  /** 전체(등록) 수강생 — enrollment 기준, 출결 카운트 포함. */
  allStudents: ClassStudentRow[];
  /** 회차(날짜)별 수강생 — aca_tickets 기준. 회차 없으면 빈 결과 → 회차 탭 미표시. */
  sessions: ClassSessionsResult;
  /** 발송 권한(write/group). 발송 버튼·체크박스 노출. */
  canSend: boolean;
  /** 학부모 연락처 풀 노출 권한(master). false 면 마스킹. */
  canRevealPhone: boolean;
}

/** 통합 명단 한 사람(전체·회차 공통 표시 필드). */
interface RosterRow {
  /** crm_students.id (회차 탭의 미매핑 학생은 null → 발송·링크 불가). */
  id: string | null;
  key: string;
  name: string;
  school: string | null;
  grade: string | null;
  parent_phone: string | null;
}

const ALL_KEY = "all";

/**
 * 강좌 상세 · 수강생 명단 (전체 + 회차 통합 + 발송 대상 체크).
 *
 * 위쪽 탭에서 [전체 | 1회차 | 2회차 …] 선택:
 *  - 전체 : enrollment 기준 등록 수강생 전원 + 출/지/조/보 출결 카운트.
 *  - 회차 : aca_tickets 기준 그 날(class_date) 수업 듣는 학생만.
 *
 * 체크박스로 발송 대상을 빼고/넣고 → '문자 발송' 시 선택된 학생만 발송 그룹에
 * prefill 된다(/groups/new 의 include/exclude 파라미터). 기본은 전원 선택.
 * 학부모 연락처는 한 줄(whitespace-nowrap) + 넉넉한 컬럼 폭.
 */
export function ClassRoster({
  allStudents,
  sessions,
  canSend,
  canRevealPhone,
}: Props) {
  const sessionList = sessions.sessions;

  const [selectedKey, setSelectedKey] = useState(ALL_KEY);
  const isAll = selectedKey === ALL_KEY;
  const selectedSession = useMemo(
    () => sessionList.find((s) => s.date === selectedKey) ?? null,
    [sessionList, selectedKey],
  );

  const rows: RosterRow[] = useMemo(() => {
    if (isAll) {
      return allStudents.map((s) => ({
        id: s.id,
        key: s.id,
        name: s.name,
        school: s.school,
        grade: s.grade,
        parent_phone: s.parent_phone,
      }));
    }
    if (!selectedSession) return [];
    return selectedSession.students.map((s) => ({
      id: s.id,
      key: s.aca_student_id,
      name: s.name,
      school: s.school,
      grade: typeof s.grade === "string" ? s.grade : (s.grade ?? null),
      parent_phone: s.parent_phone,
    }));
  }, [isAll, allStudents, selectedSession]);

  // 발송 가능 = crm_students 매핑 + 연락처 있는 학생만 체크 대상.
  const sendableIds = useMemo(
    () =>
      rows
        .filter((r) => r.id !== null && !!r.parent_phone)
        .map((r) => r.id as string),
    [rows],
  );

  // 제외 집합(체크 해제된 id). 기본 전원 선택(빈 집합). 탭 바뀌면 초기화.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  useEffect(() => {
    setExcluded(new Set());
  }, [selectedKey]);

  const selectedCount = sendableIds.filter((id) => !excluded.has(id)).length;
  const allChecked = sendableIds.length > 0 && selectedCount === sendableIds.length;

  const toggle = (id: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setExcluded(allChecked ? new Set(sendableIds) : new Set());
  };

  // 발송 모달에 넘길 선택 학생(체크된 발송 가능 학생) → {name, phone}.
  const selectedRecipients = useMemo(
    () =>
      rows
        .filter(
          (r) =>
            r.id !== null &&
            !!r.parent_phone &&
            !excluded.has(r.id as string),
        )
        .map((r) => ({ name: r.name, phone: r.parent_phone as string })),
    [rows, excluded],
  );

  const [sendOpen, setSendOpen] = useState(false);
  const contextLabel = isAll
    ? "전체 수강생"
    : selectedSession
      ? `${selectedSession.sessionNo}회차 · ${formatMonthDay(selectedSession.date)}`
      : "";

  const phoneCell = (raw: string | null) =>
    raw ? (canRevealPhone ? formatPhone(raw) || raw : maskPhone(raw)) : "—";

  const selectable = canSend && sendableIds.length > 0;

  return (
    <div className="space-y-3">
      {/* 탭: 전체 + 회차들 */}
      <div
        className="flex gap-2 overflow-x-auto pb-1"
        role="tablist"
        aria-label="명단 보기 선택"
      >
        <Chip
          active={isAll}
          onClick={() => setSelectedKey(ALL_KEY)}
          top="전체"
          bottom={`${allStudents.length.toLocaleString()}명`}
        />
        {sessionList.map((s) => (
          <Chip
            key={s.date}
            active={selectedKey === s.date}
            onClick={() => setSelectedKey(s.date)}
            top={`${s.sessionNo}회차`}
            bottom={`${formatMonthDay(s.date)} · ${s.students.length}명`}
          />
        ))}
      </div>

      {/* 명단 헤더 바: 제목 + 선택 인원 + 발송 버튼 */}
      <div className="flex items-center gap-2 px-1 flex-wrap">
        {isAll ? (
          <span className="text-[15px] font-semibold text-[color:var(--text)]">
            전체 수강생
          </span>
        ) : (
          <>
            <CalendarDays
              className="size-4 text-[color:var(--text-muted)]"
              strokeWidth={1.75}
              aria-hidden
            />
            <span className="text-[15px] font-semibold text-[color:var(--text)]">
              {selectedSession?.sessionNo}회차 ·{" "}
              {selectedSession ? formatMonthDay(selectedSession.date) : ""}
            </span>
          </>
        )}
        <span className="text-[13px] text-[color:var(--text-muted)] tabular-nums">
          {rows.length.toLocaleString()}명
          {selectable && ` · 선택 ${selectedCount.toLocaleString()}명`}
        </span>
        <div className="flex-1" />
        {selectable && (
          <button
            type="button"
            onClick={() => setSendOpen(true)}
            disabled={selectedCount === 0}
            className={`
              inline-flex items-center gap-1.5 h-9 px-3 rounded-lg shrink-0
              text-[13px] font-medium transition-colors
              ${
                selectedCount === 0
                  ? "bg-[color:var(--bg-muted)] text-[color:var(--text-dim)] cursor-not-allowed"
                  : "bg-[color:var(--action)] text-[color:var(--action-text)] hover:bg-[color:var(--action-hover)]"
              }
            `}
          >
            <Send className="size-4" strokeWidth={1.75} aria-hidden />
            {isAll ? "선택 학생에게 문자 발송" : "이 회차로 문자 발송"}
          </button>
        )}
      </div>

      {sendOpen && selectedRecipients.length > 0 && (
        <ClassSendModal
          recipients={selectedRecipients}
          contextLabel={contextLabel}
          onClose={() => setSendOpen(false)}
        />
      )}

      {/* 표 */}
      <div className="rounded-xl border border-[color:var(--border)] bg-bg-card overflow-x-auto">
        {rows.length === 0 ? (
          <p className="px-4 py-12 text-center text-[14px] text-[color:var(--text-muted)]">
            {isAll
              ? "이 강좌에 등록된 학생이 없습니다."
              : "이 회차에 수업 듣는 학생이 없습니다."}
          </p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[color:var(--border)] bg-[color:var(--bg-muted)]">
                {selectable && (
                  <Th className="w-12 text-center">
                    <input
                      type="checkbox"
                      aria-label="전체 선택"
                      checked={allChecked}
                      onChange={toggleAll}
                      className="size-4 cursor-pointer accent-[color:var(--action)] align-middle"
                    />
                  </Th>
                )}
                <Th className="w-12 text-right">순번</Th>
                <Th>이름</Th>
                <Th className="w-32">학교</Th>
                <Th className="w-16 text-center">학년</Th>
                <Th className="w-44">학부모 연락처</Th>
                {isAll && (
                  <>
                    <Th className="w-12 text-right">출</Th>
                    <Th className="w-12 text-right">지</Th>
                    <Th className="w-12 text-right">조</Th>
                    <Th className="w-12 text-right">보</Th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const counts = isAll ? allStudents[i] : null;
                const canSendRow = r.id !== null && !!r.parent_phone;
                const checked = canSendRow && !excluded.has(r.id as string);
                return (
                  <tr
                    key={r.key}
                    className="border-b border-[color:var(--border)] last:border-b-0 hover:bg-[color:var(--bg-hover)] transition-colors"
                  >
                    {selectable && (
                      <Td className="text-center">
                        <input
                          type="checkbox"
                          aria-label={`${r.name} 발송 대상`}
                          checked={checked}
                          disabled={!canSendRow}
                          onChange={() => canSendRow && toggle(r.id as string)}
                          className="size-4 cursor-pointer accent-[color:var(--action)] align-middle disabled:opacity-40 disabled:cursor-not-allowed"
                        />
                      </Td>
                    )}
                    <Td className="text-right tabular-nums text-[color:var(--text-muted)]">
                      {i + 1}
                    </Td>
                    <Td className="font-medium text-[color:var(--text)]">
                      {r.id ? (
                        <Link
                          href={`/students/${r.id}`}
                          className="hover:underline"
                        >
                          {r.name || "—"}
                        </Link>
                      ) : (
                        r.name || "—"
                      )}
                    </Td>
                    <Td className="text-[color:var(--text-muted)]">
                      {r.school ?? "—"}
                    </Td>
                    <Td className="text-center text-[color:var(--text)]">
                      {r.grade ?? "—"}
                    </Td>
                    <Td className="tabular-nums text-[color:var(--text-muted)] whitespace-nowrap">
                      {phoneCell(r.parent_phone)}
                    </Td>
                    {isAll && counts && (
                      <>
                        <CountTd value={counts.attended_count} />
                        <CountTd value={counts.late_count} />
                        <CountTd value={counts.early_leave_count} />
                        <CountTd value={counts.makeup_count} />
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── 내부 소 컴포넌트 ───────────────────────────────────────

function Chip({
  active,
  onClick,
  top,
  bottom,
}: {
  active: boolean;
  onClick: () => void;
  top: string;
  bottom: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`
        shrink-0 inline-flex flex-col items-center justify-center
        min-h-[44px] px-3 py-1.5 rounded-lg border text-center transition-colors
        ${
          active
            ? "bg-[color:var(--text)] text-[color:var(--bg-card)] border-[color:var(--text)]"
            : "bg-bg-card text-[color:var(--text)] border-[color:var(--border)] hover:bg-[color:var(--bg-hover)]"
        }
      `}
    >
      <span className="text-[13px] font-semibold leading-tight">{top}</span>
      <span
        className={`text-[12px] tabular-nums leading-tight ${
          active
            ? "text-[color:var(--bg-card)] opacity-80"
            : "text-[color:var(--text-muted)]"
        }`}
      >
        {bottom}
      </span>
    </button>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`px-4 py-3 text-left text-[13px] font-medium text-[color:var(--text-muted)] uppercase tracking-wide ${className}`}
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

function CountTd({ value }: { value: number }) {
  return (
    <td className="px-4 py-3 text-[15px] text-right tabular-nums text-[color:var(--text)]">
      {value > 0 ? (
        value
      ) : (
        <span className="text-[color:var(--text-dim)]">·</span>
      )}
    </td>
  );
}

/** ISO 'YYYY-MM-DD' → 'M월 D일'. */
function formatMonthDay(iso: string): string {
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  if (!m || !d) return iso;
  return `${m}월 ${d}일`;
}
