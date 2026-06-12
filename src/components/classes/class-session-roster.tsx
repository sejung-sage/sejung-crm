"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarDays, Send } from "lucide-react";
import type { ClassSessionsResult } from "@/lib/classes/get-class-sessions";
import { formatPhone } from "@/lib/phone";

interface Props {
  sessions: ClassSessionsResult;
  /** 강좌 id — 회차별 발송 진입(/groups/new?class=&sessionDate=)에 사용. */
  classId: string;
  /** 발송 권한(write/group). false 면 발송 버튼 숨김. */
  canSend: boolean;
}

/**
 * 회차(날짜)별 수강 명단.
 *
 * aca_tickets 가 "학생 × 수업일" 단위라, 회차(날짜) 칩을 누르면 그 날 티켓 있는
 * 학생만 명단에 뜬다. 8회 중 7회만 듣는 학생은 안 듣는 날짜 칩에선 빠진다.
 * (강좌 전체 명단은 별도 '수강생 명단' 섹션이 담당 — 여기는 회차 단위.)
 *
 * 발송 연결(3단계)에서 선택 회차 명단으로 바로 문자 발송 버튼을 붙인다.
 */
export function ClassSessionRoster({ sessions, classId, canSend }: Props) {
  const list = sessions.sessions;

  // 기본 선택: 오늘 이후(>=) 첫 회차, 없으면 마지막 회차. (운영자가 보통 다가오는·
  // 최근 회차를 본다.)
  const defaultIdx = useMemo(() => {
    if (list.length === 0) return 0;
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = list.findIndex((s) => s.date >= today);
    return upcoming >= 0 ? upcoming : list.length - 1;
  }, [list]);

  const [selectedIdx, setSelectedIdx] = useState(defaultIdx);
  const selected = list[selectedIdx] ?? list[0];

  if (list.length === 0) return null;

  // 발송 가능 = crm_students 매핑되고 연락처 있는 학생이 1명 이상.
  const hasSendable = selected.students.some(
    (s) => s.id !== null && !!s.parent_phone,
  );

  return (
    <section className="space-y-3" aria-label="회차별 명단">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
          회차별 명단
        </h2>
        <span className="text-[13px] text-[color:var(--text-muted)]">
          회차를 선택하면 그 날 수업 듣는 학생만 보입니다 · 총{" "}
          {sessions.totalSessions}회차
        </span>
      </div>

      {/* 회차(날짜) 칩 */}
      <div
        className="flex gap-2 overflow-x-auto pb-1"
        role="tablist"
        aria-label="회차 선택"
      >
        {list.map((s, idx) => {
          const active = idx === selectedIdx;
          return (
            <button
              key={s.date}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSelectedIdx(idx)}
              className={`
                shrink-0 inline-flex flex-col items-center justify-center
                min-h-[44px] px-3 py-1.5 rounded-lg border text-center
                transition-colors
                ${
                  active
                    ? "bg-[color:var(--text)] text-[color:var(--bg-card)] border-[color:var(--text)]"
                    : "bg-bg-card text-[color:var(--text)] border-[color:var(--border)] hover:bg-[color:var(--bg-hover)]"
                }
              `}
            >
              <span className="text-[13px] font-semibold leading-tight">
                {s.sessionNo}회차
              </span>
              <span
                className={`text-[12px] tabular-nums leading-tight ${
                  active
                    ? "text-[color:var(--bg-card)] opacity-80"
                    : "text-[color:var(--text-muted)]"
                }`}
              >
                {formatMonthDay(s.date)} · {s.students.length}명
              </span>
            </button>
          );
        })}
      </div>

      {/* 선택 회차 명단 */}
      <div className="rounded-xl border border-[color:var(--border)] bg-bg-card overflow-hidden">
        <header className="flex items-center gap-2 px-4 py-3 border-b border-[color:var(--border)] bg-[color:var(--bg-muted)]">
          <CalendarDays
            className="size-4 text-[color:var(--text-muted)]"
            strokeWidth={1.75}
            aria-hidden
          />
          <h3 className="text-[15px] font-semibold text-[color:var(--text)]">
            {selected.sessionNo}회차 · {formatMonthDay(selected.date)}
          </h3>
          <span className="text-[13px] text-[color:var(--text-muted)] tabular-nums">
            {selected.students.length.toLocaleString()}명
          </span>
          <div className="flex-1" />
          {canSend && hasSendable && (
            <Link
              href={`/groups/new?class=${classId}&sessionDate=${selected.date}`}
              className="
                inline-flex items-center gap-1.5 h-9 px-3 rounded-lg shrink-0
                bg-[color:var(--action)] text-[color:var(--action-text)]
                text-[13px] font-medium
                hover:bg-[color:var(--action-hover)]
                transition-colors
              "
            >
              <Send className="size-4" strokeWidth={1.75} aria-hidden />이 회차로
              문자 발송
            </Link>
          )}
        </header>

        {selected.students.length === 0 ? (
          <p className="px-4 py-10 text-center text-[14px] text-[color:var(--text-muted)]">
            이 회차에 수업 듣는 학생이 없습니다.
          </p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[color:var(--border)] text-[12px] text-[color:var(--text-muted)] uppercase tracking-wide">
                <Th className="w-12 text-right">순번</Th>
                <Th>이름</Th>
                <Th>학교</Th>
                <Th className="w-16">학년</Th>
                <Th className="w-36">학부모 연락처</Th>
              </tr>
            </thead>
            <tbody>
              {selected.students.map((st, i) => (
                <tr
                  key={st.aca_student_id}
                  className="border-b border-[color:var(--border)] last:border-b-0"
                >
                  <Td className="text-right tabular-nums text-[color:var(--text-muted)]">
                    {i + 1}
                  </Td>
                  <Td className="font-medium text-[color:var(--text)]">
                    {st.name || "—"}
                  </Td>
                  <Td className="text-[color:var(--text-muted)]">
                    {st.school ?? "—"}
                  </Td>
                  <Td className="text-[color:var(--text-muted)]">
                    {st.grade ?? "—"}
                  </Td>
                  <Td className="tabular-nums text-[color:var(--text)]">
                    {st.parent_phone
                      ? formatPhone(st.parent_phone) || st.parent_phone
                      : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
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
    <th className={`px-4 py-2.5 text-left font-medium ${className}`}>
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
  return <td className={`px-4 py-2.5 text-[15px] ${className}`}>{children}</td>;
}

/** ISO 'YYYY-MM-DD' → 'M월 D일'. */
function formatMonthDay(iso: string): string {
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  if (!m || !d) return iso;
  return `${m}월 ${d}일`;
}
