"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Loader2, X } from "lucide-react";
import type { ClassOption } from "@/lib/classes/list-class-options";
import type { ClassSessionDate } from "@/lib/classes/list-class-session-dates";
import { listClassSessionDatesAction } from "@/app/(features)/compose/actions";
import { MultiSelectDropdown } from "@/components/shell/multi-select-dropdown";

/**
 * 강좌 + 회차(수업일) **포함** 필터 UI — "강좌 클릭 → 회차 클릭" (0118).
 *
 * 개강문자 흐름: 강좌를 고르면 그 강좌의 수업일 목록이 펼쳐지고, 개강일(1회차)만
 * 체크하면 그날 수강권이 있는 학생에게만 나간다.
 *
 * 회차 선택은 **강좌를 정확히 1개** 골랐을 때만 노출한다.
 *   여러 강좌 + 여러 날짜를 동시에 걸면 매칭이 (강좌 ∈ 선택) AND (날짜 ∈ 선택) 의
 *   교차곱이라, "A강좌 8/12 와 B강좌 8/14" 를 고른 줄 알았는데 "A강좌 8/14" 까지
 *   섞여 들어온다. 운영자가 화면만 보고 그 차이를 알 수 없어 위험하므로, 회차를
 *   고르는 순간은 강좌 1개로 제한한다. 강좌를 여러 개 고르면 전 회차가 대상이다.
 */
export function IncludeClassPicker({
  options,
  selected,
  selectedDates,
  branch,
  onToggleClass,
  onRemoveClass,
  onChangeDates,
}: {
  /** 분원 진행 중 강좌 후보. */
  options: ClassOption[];
  /** 선택된 강좌 (라벨 표시용 메타 포함). */
  selected: ClassOption[];
  /** 선택된 수업일 'YYYY-MM-DD'. 빈 배열 = 전 회차. */
  selectedDates: string[];
  /** 회차 조회 권한 기준 분원. */
  branch: string;
  onToggleClass: (c: ClassOption) => void;
  onRemoveClass: (id: string) => void;
  onChangeDates: (dates: string[]) => void;
}) {
  const labelOf = (c: ClassOption) =>
    c.teacher_name ? `${c.name} · ${c.teacher_name}` : c.name;

  const merged = useMemo(() => {
    const byId = new Map<string, ClassOption>();
    for (const c of options) byId.set(c.id, c);
    for (const c of selected) if (!byId.has(c.id)) byId.set(c.id, c);
    return Array.from(byId.values());
  }, [options, selected]);

  const optionByLabel = useMemo(() => {
    const m = new Map<string, ClassOption>();
    for (const c of merged) {
      const label = labelOf(c);
      if (!m.has(label)) m.set(label, c);
    }
    return m;
  }, [merged]);

  const labelOptions = useMemo(
    () =>
      Array.from(optionByLabel.keys()).sort((a, b) => a.localeCompare(b, "ko")),
    [optionByLabel],
  );
  const selectedLabels = useMemo(() => selected.map(labelOf), [selected]);

  // 회차 드릴다운은 강좌 1개일 때만.
  const soleClass = selected.length === 1 ? selected[0] : null;

  const [sessions, setSessions] = useState<ClassSessionDate[]>([]);
  // 회차가 0개일 때만 채워지는 등록 학생 수 — "왜 0명인지" 안내용.
  const [enrolledCount, setEnrolledCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  // 선택 강좌가 바뀌면 회차 목록 재조회. 강좌가 0개/2개 이상이면 목록을 비운다.
  useEffect(() => {
    const myReq = ++reqIdRef.current;
    if (!soleClass || !branch) {
      setSessions([]);
      setEnrolledCount(0);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    void (async () => {
      const result = await listClassSessionDatesAction({
        classId: soleClass.id,
        branch,
      });
      // 늦게 도착한 이전 요청 무시 (강좌를 빠르게 바꿀 때 목록이 뒤섞이는 것 방지).
      if (myReq !== reqIdRef.current) return;
      setLoading(false);
      if (result.status === "success") {
        setSessions(result.sessions);
        setEnrolledCount(result.enrolledCount);
      } else {
        setSessions([]);
        setEnrolledCount(0);
        setError(result.reason);
      }
    })();
  }, [soleClass, branch]);

  const toggleDate = (date: string) => {
    onChangeDates(
      selectedDates.includes(date)
        ? selectedDates.filter((d) => d !== date)
        : [...selectedDates, date],
    );
  };

  return (
    <div className="space-y-2">
      <MultiSelectDropdown
        label="+ 강좌 선택"
        options={labelOptions}
        selected={selectedLabels}
        onToggle={(label) => {
          const c = optionByLabel.get(label);
          if (c) onToggleClass(c);
        }}
        searchable
        searchPlaceholder="강좌명·강사 검색..."
        emptyHint="이 분원에 진행 중 강좌가 없습니다"
      />

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {selected.map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center gap-1 h-8 pl-3 pr-1.5 rounded-full border border-[color:var(--border-strong)] bg-bg-card text-[13px] font-medium text-[color:var(--text)]"
            >
              <span>{c.name}</span>
              {c.teacher_name && (
                <span className="text-[11px] text-[color:var(--text-muted)]">
                  {c.teacher_name}
                </span>
              )}
              <button
                type="button"
                onClick={() => onRemoveClass(c.id)}
                aria-label={`${c.name} 선택 해제`}
                className="ml-0.5 size-5 inline-flex items-center justify-center rounded-full text-[color:var(--text-muted)] hover:bg-[color:var(--bg-hover)]"
              >
                <X className="size-3.5" strokeWidth={2} aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* ── 회차(수업일) 드릴다운 ── */}
      {soleClass && (
        <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <CalendarDays
              className="size-3.5 text-[color:var(--text-muted)]"
              strokeWidth={1.75}
              aria-hidden
            />
            <span className="text-[13px] font-medium text-[color:var(--text)]">
              수업일 (회차)
            </span>
            <span className="text-[12px] text-[color:var(--text-muted)]">
              {selectedDates.length === 0
                ? "선택 안 함 = 전 회차"
                : `${selectedDates.length}개 회차 선택`}
            </span>
            {loading && (
              <Loader2
                className="size-3.5 animate-spin text-[color:var(--text-muted)]"
                aria-hidden
              />
            )}
          </div>

          {error && (
            <p
              role="alert"
              className="text-[12px] text-[color:var(--danger)]"
            >
              {error}
            </p>
          )}

          {/*
            회차 0개 = 수강권(티켓)이 발급되지 않은 강좌. 설명회·독학관 등이
            해당하며 운영 데이터의 4~16% 를 차지한다(2026-08-07 실측).
            이 필터는 티켓 기준이라 그런 강좌는 0명이 잡히는데, 화면만 봐서는
            이유를 알 수 없어 등록 인원과 함께 명시한다.
          */}
          {!loading && !error && sessions.length === 0 && (
            <p className="text-[12px] leading-relaxed text-[color:var(--text)]">
              {enrolledCount > 0 ? (
                <>
                  이 강좌는 수강권(회차) 정보가 없어 <strong>발송 대상이 0명</strong>
                  입니다. 등록된 학생은{" "}
                  <strong className="tabular-nums">
                    {enrolledCount.toLocaleString("ko-KR")}명
                  </strong>
                  입니다. 설명회는 <strong>문자 발송 › 설명회 문자</strong>, 그 외에는
                  강좌 상세 명단에서 직접 골라 보내세요.
                </>
              ) : (
                <span className="text-[color:var(--text-muted)]">
                  이 강좌에는 등록된 수업일도 학생도 없습니다.
                </span>
              )}
            </p>
          )}

          {sessions.length > 0 && (
            <>
              <ul className="max-h-56 overflow-y-auto space-y-0.5">
                {sessions.map((s) => (
                  <li key={s.date}>
                    <label className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-[color:var(--bg-hover)]">
                      <input
                        type="checkbox"
                        checked={selectedDates.includes(s.date)}
                        onChange={() => toggleDate(s.date)}
                        className="size-4 accent-[color:var(--action)]"
                      />
                      <span className="text-[14px] text-[color:var(--text)] tabular-nums">
                        {s.sessionNo}회차
                      </span>
                      <span className="text-[14px] text-[color:var(--text-muted)] tabular-nums">
                        {formatSessionDate(s.date)}
                      </span>
                      <span className="ml-auto text-[12px] text-[color:var(--text-muted)] tabular-nums">
                        {s.studentCount.toLocaleString("ko-KR")}명
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {selectedDates.length > 0 && (
                <button
                  type="button"
                  onClick={() => onChangeDates([])}
                  className="text-[12px] text-[color:var(--text-muted)] underline underline-offset-2 hover:text-[color:var(--text)]"
                >
                  회차 선택 해제 (전 회차로)
                </button>
              )}
            </>
          )}
        </div>
      )}

      {selected.length > 1 && (
        <p className="text-[12px] text-[color:var(--text-muted)]">
          강좌를 2개 이상 고르면 전 회차가 대상입니다. 특정 수업일만 보내려면
          강좌를 하나만 선택하세요.
        </p>
      )}
    </div>
  );
}

/** 'YYYY-MM-DD' → 'M/D (요일)'. 40~60대 사용자가 날짜를 한눈에 읽도록 요일 병기. */
function formatSessionDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  // 로컬 타임존 해석 차이를 피하려고 UTC 로 만들고 UTC 요일을 읽는다.
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][dt.getUTCDay()];
  return `${m}/${d} (${weekday})`;
}
