"use client";

import { Clock } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * 사이드바 하단 KST 시계.
 *
 * - Asia/Seoul 고정 표기 — 사용자(서울) 기기 시간대가 잘못 설정돼 있어도
 *   본 화면에서는 항상 한국 시간으로 노출.
 * - 분 단위 표시. 60초 간격으로 갱신.
 * - SSR/CSR hydration mismatch 회피: 초기 렌더는 빈 자리, useEffect 진입
 *   직후 setNow 로 채움.
 */
export function SidebarClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // 마운트 즉시 표시
    setNow(new Date());

    // 다음 정각(분) 까지 대기 후 60초 주기 — 분 갱신을 정확하게.
    const msUntilNextMinute = 60_000 - (Date.now() % 60_000);
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const timeoutId = setTimeout(() => {
      setNow(new Date());
      intervalId = setInterval(() => setNow(new Date()), 60_000);
    }, msUntilNextMinute);

    return () => {
      clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  const label = now ? formatKstLabel(now) : "";

  return (
    <div
      className="
        flex items-center gap-2 px-3 py-2 rounded-lg
        bg-[color:var(--bg-muted)]
        text-[13px] text-[color:var(--text-muted)]
      "
      aria-label="현재 시각 (한국 표준시)"
    >
      <Clock
        className="size-4 shrink-0 text-[color:var(--text-dim)]"
        strokeWidth={1.75}
        aria-hidden
      />
      <span
        className="tabular-nums text-[color:var(--text)] font-medium"
        suppressHydrationWarning
      >
        {label || "—"}
      </span>
    </div>
  );
}

/**
 * Asia/Seoul 기준 "M월 D일 (요일) 오전/오후 H:MM" 라벨.
 * 40~60대 사용자 가독성 우선 — 24h 보다 오전/오후 표기가 직관적.
 */
function formatKstLabel(d: Date): string {
  const fmt = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  // 예: "5월 21일 (수) 오전 11:23"
  return fmt.format(d);
}
