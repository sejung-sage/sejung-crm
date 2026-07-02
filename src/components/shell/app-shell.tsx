import { Sidebar } from "./sidebar";
import { FailureAlertBanner } from "./failure-alert-banner";
import { getFailedCampaignAlerts } from "@/lib/notifications/failed-campaign-alerts";

/**
 * 애플리케이션 셸 래퍼
 *
 * 좌측 사이드바(240px 고정) + 우측 메인 컨텐츠.
 * 상단 여백 24px, 좌우 여백은 페이지 레이아웃에서 결정.
 *
 * 메인 콘텐츠 최상단에 발송 실패 알림 배너를 둔다. 서버에서 미확인 실패
 * 캠페인을 조회해 배너에 내려주고(클라이언트 렌더+60초 폴링), 모든 피처
 * 페이지에서 공통으로 보이게 한다. 실패가 없으면 배너는 null 을 렌더한다.
 *
 * 반응형은 태블릿까지만 지원. 모바일은 Phase 1+ 스코프.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const failedAlerts = await getFailedCampaignAlerts();

  return (
    <div className="flex min-h-screen bg-[color:var(--bg)] text-[color:var(--text)]">
      <Sidebar />
      <main className="flex-1 min-w-0 pt-6 px-8 pb-12">
        <FailureAlertBanner alerts={failedAlerts} />
        {children}
      </main>
    </div>
  );
}
