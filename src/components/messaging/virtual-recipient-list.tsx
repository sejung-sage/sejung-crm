"use client";

import { useEffect, useRef, useState } from "react";
import type { MatchedRecipient } from "@/app/(features)/compose/actions";
import { formatPhone } from "@/lib/phone";

/**
 * 매칭 학생 체크 목록 — 가상 스크롤.
 *
 * 1만 명 너머(분원 최대 ~6.4만)도 전부 표시하되, 화면에 보이는 줄만 실제로 그린다.
 * 고정 행 높이 기반 windowing — 라이브러리 없이 scrollTop/뷰포트 높이로 가시 구간만 렌더.
 * 일반문자(compose-inline)와 설명회(seminar-compose-step-2-target) 공용.
 *
 * 부모는 절대 위치 컨테이너(예: `relative flex-1 min-h-0`) 안에 둔다 — 이 컴포넌트가
 * `absolute inset-0` 로 그 영역을 채운다.
 */

const RECIPIENT_ROW_H = 36;

export function VirtualRecipientList({
  recipients,
  isChecked,
  onToggle,
}: {
  recipients: MatchedRecipient[];
  isChecked: (studentId: string) => boolean;
  onToggle: (studentId: string, checked: boolean) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setViewportH(el.clientHeight);
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const total = recipients.length;
  const overscan = 10;
  const start = Math.max(0, Math.floor(scrollTop / RECIPIENT_ROW_H) - overscan);
  const end = Math.min(
    total,
    Math.ceil((scrollTop + viewportH) / RECIPIENT_ROW_H) + overscan,
  );
  const slice = recipients.slice(start, end);

  return (
    <div
      ref={containerRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className="absolute inset-0 overflow-auto"
    >
      {/* 전체 높이 스페이서로 스크롤바를 실제 인원수만큼 만든다. */}
      <div style={{ height: total * RECIPIENT_ROW_H, position: "relative" }}>
        <ul
          style={{
            position: "absolute",
            top: start * RECIPIENT_ROW_H,
            left: 0,
            right: 0,
          }}
          className="divide-y divide-[color:var(--border)]"
        >
          {slice.map((r) => {
            const checked = isChecked(r.studentId);
            const phone = r.parentPhone || r.studentPhone;
            return (
              <li key={r.studentId} style={{ height: RECIPIENT_ROW_H }}>
                <label className="flex items-center gap-2.5 px-3 h-full cursor-pointer hover:bg-[color:var(--bg-hover)]">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => onToggle(r.studentId, e.target.checked)}
                    className="size-4 accent-[color:var(--action)] shrink-0"
                  />
                  <span className="text-[13px] font-medium text-[color:var(--text)] truncate">
                    {r.name}
                  </span>
                  <span className="text-[12px] tabular-nums text-[color:var(--text-muted)] ml-auto shrink-0">
                    {phone ? formatPhone(phone) || phone : "번호 없음"}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
