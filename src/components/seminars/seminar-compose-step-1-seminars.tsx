"use client";

import Link from "next/link";
import { Calendar, MapPin, Plus, Users } from "lucide-react";
import type { SeminarListItem } from "@/types/database";
import { formatKstDateTime } from "@/lib/datetime";

/**
 * F5 · 설명회 발송 Step 1 — 발송할 설명회를 1개 이상 다중 선택.
 *
 * 표시: 분원 컨텍스트의 status='open' 설명회만(서버에서 필터됨).
 * 카드 단위 체크박스 + 일시/장소/정원/신청수 노출.
 *
 * 한 학부모 페이지에 N장 카드를 다 띄우려면 N개를 모두 선택. 보통 1~2개.
 */
interface Props {
  seminars: SeminarListItem[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function SeminarComposeStep1Seminars({
  seminars,
  selectedIds,
  onChange,
}: Props) {
  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((v) => v !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
          발송할 설명회 선택
        </h2>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          학부모 페이지에 카드로 표시할 설명회를 1개 이상 선택해 주세요. 학생에게
          여러 일정을 한 번에 안내할 수 있습니다.
        </p>
      </div>

      {seminars.length === 0 ? (
        <div
          role="alert"
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-4 py-5 text-[14px] text-[color:var(--text-muted)] space-y-2"
        >
          <p>현재 분원에 모집 중인 설명회가 없습니다.</p>
          <Link
            href="/seminars/new"
            className="
              inline-flex items-center gap-1.5 h-9 px-3 rounded-lg
              bg-[color:var(--action)] text-[color:var(--action-text)]
              text-[14px] font-medium
              hover:bg-[color:var(--action-hover)]
              transition-colors
            "
          >
            <Plus className="size-4" strokeWidth={2} aria-hidden />새 설명회
          </Link>
        </div>
      ) : (
        <ul className="space-y-3" aria-label="설명회 목록">
          {seminars.map((s) => {
            const checked = selectedIds.includes(s.id);
            const inputId = `seminar-${s.id}`;
            return (
              <li key={s.id}>
                <label
                  htmlFor={inputId}
                  className={`
                    flex items-start gap-3 rounded-xl border p-4 cursor-pointer
                    ${checked
                      ? "border-[color:var(--text)] bg-[color:var(--bg-muted)]"
                      : "border-[color:var(--border)] bg-bg-card hover:bg-[color:var(--bg-hover)]"}
                    transition-colors
                  `}
                >
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(s.id)}
                    className="mt-1 size-5 cursor-pointer accent-[color:var(--action)]"
                    aria-label={`${s.name} 선택`}
                  />
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="text-[15px] font-semibold text-[color:var(--text)] leading-snug">
                      {s.name}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-[color:var(--text-muted)]">
                      {s.held_at && (
                        <span className="inline-flex items-center gap-1 tabular-nums">
                          <Calendar
                            className="size-3.5 text-[color:var(--text-dim)]"
                            strokeWidth={1.75}
                            aria-hidden
                          />
                          {formatKstDateTime(s.held_at)}
                        </span>
                      )}
                      {s.venue && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin
                            className="size-3.5 text-[color:var(--text-dim)]"
                            strokeWidth={1.75}
                            aria-hidden
                          />
                          {s.venue}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Users
                          className="size-3.5 text-[color:var(--text-dim)]"
                          strokeWidth={1.75}
                          aria-hidden
                        />
                        {s.signup_count}
                        {s.capacity ? ` / ${s.capacity}` : ""}명 신청
                      </span>
                    </div>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[12px] text-[color:var(--text-dim)]">
        선택된 설명회 <strong className="text-[color:var(--text)]">{selectedIds.length}</strong>개
        · 학부모 페이지에 카드 순서대로 노출됩니다.
      </p>
    </div>
  );
}
