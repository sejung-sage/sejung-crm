import { listCampaigns } from "@/lib/campaigns/list-campaigns";
import { CampaignListQuerySchema } from "@/lib/schemas/campaign";
import { CampaignsToolbar } from "@/components/campaigns/campaigns-toolbar";
import { CampaignsTable } from "@/components/campaigns/campaigns-table";
import { Pagination } from "@/components/students/pagination";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";

/**
 * F3-02 · 문자 발송 내역 리스트 (/campaigns)
 *
 * Server Component. URL searchParams 기반 필터.
 */
const PAGE_SIZE = 50;

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;

  const pick = (v: string | string[] | undefined): string | undefined => {
    if (Array.isArray(v)) return v[0];
    return v;
  };

  const parsed = CampaignListQuerySchema.parse({
    q: pick(raw.q) ?? "",
    status: pick(raw.status),
    from: pick(raw.from),
    to: pick(raw.to),
    page: pick(raw.page) ?? 1,
  });

  const result = await listCampaigns(parsed);
  const devMode = isDevSeedMode();

  return (
    <div className="max-w-7xl space-y-6">
      <header>
        <h1 className="text-[20px] font-semibold text-[color:var(--text)]">
          문자 발송 내역
        </h1>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          지금까지 발송·예약한 캠페인을 확인합니다.
        </p>
      </header>

      <CampaignsToolbar />

      {devMode && (
        <div
          role="note"
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-4 py-2.5 text-[13px] text-[color:var(--text-muted)]"
        >
          개발용 시드 데이터로 표시 중입니다. 실제 발송 내역은 Supabase 연결
          후 반영됩니다.
        </div>
      )}

      <p className="text-[13px] text-[color:var(--text-muted)]">
        총{" "}
        <strong className="text-[color:var(--text)]">
          {result.total.toLocaleString()}
        </strong>
        건
      </p>

      <CampaignsTable rows={result.items} />

      <Pagination
        page={parsed.page}
        pageSize={PAGE_SIZE}
        total={result.total}
      />
    </div>
  );
}
