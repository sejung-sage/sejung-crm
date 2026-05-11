"use client";

/**
 * 캠페인 진행률 자동 새로고침.
 *
 * status='발송중' 인 동안 5초마다 `router.refresh()` 호출. Server Component 가
 * 다시 렌더링되며 진행률 카운트가 갱신된다. status 가 변하면 폴링 중단.
 *
 * 사용자가 다른 탭/창에 있는 동안 굳이 폴링을 돌릴 필요 없으므로
 * Page Visibility API 로 백그라운드 시 중단.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { CampaignStatus } from "@/types/database";

interface Props {
  status: CampaignStatus;
  /** 폴링 간격(ms). 기본 5000. */
  intervalMs?: number;
}

export function CampaignProgressPoller({
  status,
  intervalMs = 5_000,
}: Props) {
  const router = useRouter();

  useEffect(() => {
    if (status !== "발송중") return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = () => {
      if (cancelled) return;
      if (document.visibilityState === "visible") {
        router.refresh();
      }
      timer = setTimeout(tick, intervalMs);
    };

    timer = setTimeout(tick, intervalMs);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [status, intervalMs, router]);

  return null;
}
