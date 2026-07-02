"use client";

import { useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check } from "lucide-react";
import type { FailedCampaignAlert } from "@/lib/notifications/failed-campaign-alerts";
import { acknowledgeFailedCampaignsAction } from "@/app/(features)/campaigns/actions";

/**
 * 발송 실패 앱 내 알림 배너.
 *
 * 메인 콘텐츠 영역 최상단(사이드바 옆)에 렌더돼 모든 피처 페이지에서 보인다.
 * 서버(AppShell)가 `getFailedCampaignAlerts()` 결과를 alerts prop 으로 내려주고,
 * 이 클라이언트 컴포넌트는 렌더 + [확인] 처리 + 60초 폴링(router.refresh)만 한다.
 *
 * - alerts 가 비면 아무것도 렌더하지 않는다(null).
 * - [실패 목록 보기] → /campaigns?status=실패 (기존 리스트 status 필터 재사용).
 * - [확인] → acknowledgeFailedCampaignsAction() 전체 확인 후 refresh 로 배너 제거.
 * - 60초마다 router.refresh 로 백그라운드 신규 실패를 자동 노출. 언마운트 시 정리.
 */
export function FailureAlertBanner({
  alerts,
}: {
  alerts: FailedCampaignAlert[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // 화면을 보고 있지 않은 사이 발생한 실패를 60초마다 자동 반영.
  // 배너가 렌더되지 않아도(빈 배열) 새 실패를 감지하려면 폴링이 살아 있어야 하므로
  // 훅은 항상 호출하고, 렌더만 조건부로 한다.
  useEffect(() => {
    const timer = setInterval(() => {
      router.refresh();
    }, 60_000);
    return () => clearInterval(timer);
  }, [router]);

  if (alerts.length === 0) return null;

  const count = alerts.length;
  const preview = alerts.slice(0, 2);
  const remaining = count - preview.length;

  function handleAcknowledge() {
    startTransition(async () => {
      await acknowledgeFailedCampaignsAction();
      router.refresh();
    });
  }

  return (
    <div
      role="alert"
      className="
        mb-6 rounded-xl
        border border-[color:var(--danger)]
        bg-[color:var(--danger-bg)]
        px-4 py-3.5
      "
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <AlertTriangle
            className="mt-0.5 size-5 shrink-0"
            style={{ color: "var(--danger)" }}
            strokeWidth={2}
            aria-hidden
          />
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-[color:var(--text)]">
              발송 실패 {count}건 — 확인이 필요합니다
            </p>
            <ul className="mt-1 space-y-0.5 text-[13px] text-[color:var(--text-muted)]">
              {preview.map((a) => (
                <li key={a.id} className="truncate">
                  {a.title}
                  <span className="text-[color:var(--text-dim)]">
                    {" · "}
                    {a.branch} · {a.totalRecipients.toLocaleString()}명 ·{" "}
                    {formatKst(a.createdAt)}
                  </span>
                </li>
              ))}
              {remaining > 0 && <li>외 {remaining}건</li>}
            </ul>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/campaigns?status=실패"
            className="
              inline-flex h-10 items-center rounded-lg px-3.5
              border border-[color:var(--border)]
              bg-[color:var(--bg)]
              text-[14px] font-medium text-[color:var(--text)]
              hover:bg-[color:var(--bg-hover)]
              transition-colors
              focus:outline-none focus-visible:ring-2
              focus-visible:ring-[color:var(--danger)]
            "
          >
            실패 목록 보기
          </Link>
          <button
            type="button"
            onClick={handleAcknowledge}
            disabled={isPending}
            className="
              inline-flex h-10 items-center gap-1.5 rounded-lg px-3.5
              bg-[color:var(--action)]
              text-[14px] font-medium text-white
              hover:opacity-90
              transition-opacity
              disabled:opacity-60 disabled:cursor-not-allowed
              focus:outline-none focus-visible:ring-2
              focus-visible:ring-[color:var(--danger)]
            "
          >
            <Check className="size-4" strokeWidth={2} aria-hidden />
            {isPending ? "확인 중…" : "확인"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Asia/Seoul 기준 "M월 D일 오전/오후 H:MM" 라벨. 사이드바 동기화 표시와 동일 톤.
 */
function formatKst(iso: string): string {
  const fmt = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return fmt.format(new Date(iso));
}
