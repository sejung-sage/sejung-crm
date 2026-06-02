"use client";

import { useMemo, useState } from "react";
import { Search, X, Calendar, MapPin, Users } from "lucide-react";
import type { ClassSignupOption } from "@/types/database";
import { formatKstDateTime } from "@/lib/datetime";

/**
 * F5 · 설명회 발송 Step 1 — 강좌(=설명회) 다중 선택 (컴팩트 + 검색·필터).
 *
 * 0084 새 모델: 발송 대상은 crm_classes(subject='설명회') 강좌. 신청 페이지는
 * 발송 시점에 자동 find-or-create (status='open').
 *
 * UX (Aca 운영자 패턴 미러):
 *  - 컴팩트 한 줄 행. 체크박스 · 이름 · 일시 · 장소 · 신청수 / 정원.
 *  - 상단 검색박스(이름 substring, case-insensitive).
 *  - 월(YYYY-MM) 드롭다운 — held_at 기준 월 + "전체" / "일시 미정".
 *  - "전체 선택" / "전체 해제" 한 줄.
 *  - 모두 in-memory 필터 (수 십~수 백 행 가정, 서버 호출 없음).
 */
interface Props {
  classes: ClassSignupOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

type MonthKey = "all" | "tbd" | string; // "YYYY-MM"

export function SeminarComposeStep1Seminars({
  classes,
  selectedIds,
  onChange,
}: Props) {
  const [query, setQuery] = useState("");
  const [monthKey, setMonthKey] = useState<MonthKey>("all");

  // 가용 월 옵션 (held_at 의 YYYY-MM 유니크) + 일시 미정 카운트.
  const monthOptions = useMemo(() => {
    const counts = new Map<string, number>();
    let tbdCount = 0;
    for (const c of classes) {
      if (!c.held_at) {
        tbdCount += 1;
        continue;
      }
      const d = new Date(c.held_at);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const months = Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, n]) => ({ key, label: monthLabel(key), n }));
    return { months, tbdCount };
  }, [classes]);

  // 필터링.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return classes.filter((c) => {
      // 이름 검색.
      if (q && !c.class_name.toLowerCase().includes(q)) return false;
      // 월 필터.
      if (monthKey === "all") return true;
      if (monthKey === "tbd") return !c.held_at;
      if (!c.held_at) return false;
      const d = new Date(c.held_at);
      if (Number.isNaN(d.getTime())) return false;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      return key === monthKey;
    });
  }, [classes, query, monthKey]);

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((v) => v !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const filteredIds = useMemo(() => filtered.map((c) => c.class_id), [filtered]);
  const allFilteredSelected =
    filteredIds.length > 0 &&
    filteredIds.every((id) => selectedIds.includes(id));
  const someFilteredSelected = filteredIds.some((id) =>
    selectedIds.includes(id),
  );

  const toggleAllFiltered = () => {
    if (allFilteredSelected) {
      // 필터 결과에 속한 것만 빼기.
      onChange(selectedIds.filter((id) => !filteredIds.includes(id)));
    } else {
      // 기존 선택 + 필터 결과 합집합 (중복 제거).
      const next = new Set([...selectedIds, ...filteredIds]);
      onChange(Array.from(next));
    }
  };

  const clearSelection = () => onChange([]);

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
          발송할 설명회 선택
        </h2>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          학부모 페이지에 카드로 표시할 설명회를 1개 이상 선택. 학생에게 여러
          일정을 한 번에 안내할 수 있습니다.
        </p>
      </div>

      {/* 검색 + 월 필터 + 선택 카운트 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[color:var(--text-dim)]"
            strokeWidth={1.75}
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름으로 검색"
            className="
              h-10 w-full pl-9 pr-9 rounded-lg
              border border-[color:var(--border)] bg-bg-card
              text-[14px] text-[color:var(--text)]
              placeholder:text-[color:var(--text-dim)]
            "
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="검색 지우기"
              className="absolute right-2 top-1/2 -translate-y-1/2 size-7 inline-flex items-center justify-center rounded-md hover:bg-[color:var(--bg-hover)]"
            >
              <X className="size-4 text-[color:var(--text-muted)]" strokeWidth={1.75} aria-hidden />
            </button>
          )}
        </div>

        <select
          value={monthKey}
          onChange={(e) => setMonthKey(e.target.value as MonthKey)}
          aria-label="월별 필터"
          className="h-10 px-3 rounded-lg border border-[color:var(--border)] bg-bg-card text-[14px] text-[color:var(--text)]"
        >
          <option value="all">전체 ({classes.length})</option>
          {monthOptions.months.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label} ({m.n})
            </option>
          ))}
          {monthOptions.tbdCount > 0 && (
            <option value="tbd">일시 미정 ({monthOptions.tbdCount})</option>
          )}
        </select>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleAllFiltered}
            disabled={filteredIds.length === 0}
            className="
              h-10 px-3 rounded-lg
              border border-[color:var(--border)] bg-bg-card
              text-[13px] text-[color:var(--text)]
              hover:bg-[color:var(--bg-hover)]
              disabled:opacity-40 disabled:cursor-not-allowed
              transition-colors
            "
          >
            {allFilteredSelected ? "현재 결과 해제" : "현재 결과 전체 선택"}
          </button>
          {selectedIds.length > 0 && (
            <button
              type="button"
              onClick={clearSelection}
              className="
                h-10 px-3 rounded-lg
                text-[13px] text-[color:var(--text-muted)]
                hover:text-[color:var(--text)]
                transition-colors
              "
            >
              전체 해제
            </button>
          )}
        </div>
      </div>

      {/* 상태 한 줄 */}
      <p className="text-[12px] text-[color:var(--text-muted)] tabular-nums">
        결과 <strong className="text-[color:var(--text)]">{filtered.length}</strong>건 ·
        선택 <strong className="text-[color:var(--text)]">{selectedIds.length}</strong>건
      </p>

      {/* 목록 */}
      {classes.length === 0 ? (
        <div
          role="alert"
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-4 py-5 text-[14px] text-[color:var(--text-muted)] space-y-1"
        >
          <p>현재 분원에 설명회 강좌가 없습니다.</p>
          <p className="text-[13px] text-[color:var(--text-dim)]">
            아카(Aca2000) 에 설명회 강좌를 등록하면 다음 동기화(약 1시간)에 자동
            등장합니다.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-4 py-5 text-[14px] text-[color:var(--text-muted)] text-center">
          조건에 맞는 설명회가 없습니다.
        </div>
      ) : (
        <ul
          className="rounded-xl border border-[color:var(--border)] bg-bg-card overflow-hidden divide-y divide-[color:var(--border)] max-h-[420px] overflow-y-auto"
          aria-label="설명회 강좌 목록"
        >
          {filtered.map((c) => {
            const checked = selectedIds.includes(c.class_id);
            const inputId = `seminar-class-${c.class_id}`;
            return (
              <li key={c.class_id}>
                <label
                  htmlFor={inputId}
                  className={`
                    grid grid-cols-[24px_1fr_auto] items-center gap-3 px-3 py-2.5 cursor-pointer
                    ${checked ? "bg-[color:var(--bg-muted)]" : "hover:bg-[color:var(--bg-hover)]"}
                    transition-colors
                  `}
                >
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(c.class_id)}
                    className="size-5 cursor-pointer accent-[color:var(--action)]"
                    aria-label={`${c.class_name} 선택`}
                  />
                  <div className="min-w-0 flex items-center gap-3 flex-wrap">
                    <span className="text-[14px] font-medium text-[color:var(--text)] truncate">
                      {c.class_name}
                    </span>
                    {c.signup_page_status &&
                      c.signup_page_status !== "open" && (
                        <PageStatusBadge status={c.signup_page_status} />
                      )}
                    {c.signup_page_id === null && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] border border-dashed border-[color:var(--border-strong)] text-[color:var(--text-muted)] whitespace-nowrap">
                        페이지 자동 생성
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[12px] text-[color:var(--text-muted)] tabular-nums shrink-0">
                    <span className="inline-flex items-center gap-1 whitespace-nowrap">
                      <Calendar
                        className="size-3.5 text-[color:var(--text-dim)]"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                      {c.held_at ? formatKstDateTime(c.held_at) : "일시 미정"}
                    </span>
                    {c.venue && (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap max-w-[140px]">
                        <MapPin
                          className="size-3.5 text-[color:var(--text-dim)]"
                          strokeWidth={1.75}
                          aria-hidden
                        />
                        <span className="truncate">{c.venue}</span>
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 whitespace-nowrap">
                      <Users
                        className="size-3.5 text-[color:var(--text-dim)]"
                        strokeWidth={1.75}
                        aria-hidden
                      />
                      {c.signup_count}
                      {c.capacity ? `/${c.capacity}` : ""}
                    </span>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {/* someFilteredSelected 는 향후 indeterminate checkbox 도입 시 사용. 현재는 사용 안 함. */}
      {/* prettier-ignore */}
      <span className="hidden" aria-hidden>{someFilteredSelected ? "" : ""}</span>
    </div>
  );
}

// ─── 헬퍼 ───────────────────────────────────────────────────

function monthLabel(key: string): string {
  // "2026-11" → "2026년 11월"
  const [y, m] = key.split("-");
  if (!y || !m) return key;
  return `${y}년 ${parseInt(m, 10)}월`;
}

function PageStatusBadge({ status }: { status: "draft" | "closed" }) {
  if (status === "draft") {
    return (
      <span
        className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] border border-dashed border-[color:var(--border-strong)] text-[color:var(--text-muted)] whitespace-nowrap"
        title="신청 페이지가 비공개 초안 상태"
      >
        draft
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] border border-[color:var(--border)] text-[color:var(--text-muted)] bg-[color:var(--bg-muted)] whitespace-nowrap"
      title="신청 마감 상태"
    >
      마감
    </span>
  );
}
