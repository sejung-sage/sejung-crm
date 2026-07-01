import { ShieldAlert } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { listCampaignSenders } from "@/lib/campaigns/list-campaign-senders";
import {
  SendDashboardFilterSchema,
  getSendDashboard,
} from "@/lib/dashboard/send-dashboard";
import { BRANCHES } from "@/config/branches";
import { DashboardToolbar } from "@/components/dashboard/dashboard-toolbar";
import { DashboardSummary } from "@/components/dashboard/dashboard-summary";
import { DashboardTable } from "@/components/dashboard/dashboard-table";

/**
 * 발송 대시보드 (/dashboard) — 마스터 전용 문자 발송 집계.
 *
 * Server Component. URL searchParams 를 SendDashboardFilterSchema 로 파싱해
 * getSendDashboard(RPC 래퍼) 로 집계 결과를 받아 클라이언트 자식에 props 전달.
 * 마스터 게이팅은 explorer/page.tsx 와 동일 패턴(비마스터 → 접근 권한 패널).
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const devSeed = isDevSeedMode();
  const user = devSeed ? null : await getCurrentUser();
  const isMaster = devSeed || user?.role === "master";

  if (!isMaster) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-xl border border-[color:var(--border)] bg-bg-card p-8 text-center">
        <ShieldAlert
          className="mx-auto size-8 text-[color:var(--text-dim)]"
          strokeWidth={1.5}
          aria-hidden
        />
        <h1 className="mt-3 text-[17px] font-semibold text-[color:var(--text)]">
          접근 권한이 없습니다
        </h1>
        <p className="mt-1.5 text-[14px] text-[color:var(--text-muted)]">
          발송 대시보드는 master 계정만 사용할 수 있습니다.
        </p>
      </div>
    );
  }

  const raw = await searchParams;
  const pick = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;

  const filters = SendDashboardFilterSchema.parse({
    from: pick(raw.from),
    to: pick(raw.to),
    branch: pick(raw.branch),
    sender: pick(raw.sender),
    seminar: pick(raw.seminar),
    groupBy: pick(raw.groupBy),
  });

  const [rows, senders] = await Promise.all([
    getSendDashboard(filters, user),
    listCampaignSenders(),
  ]);

  return (
    <div className="max-w-7xl space-y-6">
      <header>
        <h1 className="text-[20px] font-semibold text-[color:var(--text)]">
          발송 대시보드
        </h1>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          기간·분원·발송자별 문자 발송 건수와 비용을 집계합니다.
        </p>
      </header>

      <DashboardToolbar branches={[...BRANCHES]} senders={senders} />

      <DashboardSummary rows={rows} />

      <DashboardTable rows={rows} groupBy={filters.groupBy} />
    </div>
  );
}
