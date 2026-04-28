import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { CampaignListItem, CampaignMessageRow } from "@/types/database";
import { BranchBadge } from "@/components/groups/branch-badge";
import { CampaignStatusBadge } from "@/components/campaigns/campaign-status-badge";
import { CampaignMessagesTable } from "@/components/campaigns/campaign-messages-table";
import { ResendFailedButton } from "@/components/campaigns/resend-failed-button";

/**
 * F3-02 · 캠페인 상세 뷰 (Server Component).
 *
 * 구성:
 *  1. 브레드크럼 ← 문자 발송 내역
 *  2. 상단 카드: 제목 + 상태 + 메타(템플릿/그룹/분원) + 숫자블록 + 액션
 *  3. 건별 메시지 테이블 (상태 필터 칩 포함)
 *
 * "실패 건 재발송" 버튼은 **비활성 + 툴팁** 로 Part B 전까지 노출만.
 */
interface Props {
  campaign: CampaignListItem;
  messages: CampaignMessageRow[];
}

export function CampaignDetailView({ campaign, messages }: Props) {
  const failedCount = campaign.failed_count;
  const deliveredCount = campaign.delivered_count;
  const reach =
    campaign.total_recipients > 0
      ? Math.round((deliveredCount / campaign.total_recipients) * 100)
      : 0;

  return (
    <div className="max-w-7xl space-y-6">
      {/* 브레드크럼 */}
      <Link
        href="/campaigns"
        className="inline-flex items-center gap-1 text-[13px] text-[color:var(--text-muted)] hover:text-[color:var(--text)]"
      >
        <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
        문자 발송 내역
      </Link>

      {/* 상단 카드 */}
      <section
        className="rounded-xl border border-[color:var(--border)] bg-white p-6"
        aria-label="캠페인 요약"
      >
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[24px] font-semibold leading-tight text-[color:var(--text)]">
                {campaign.title}
              </h1>
              <CampaignStatusBadge status={campaign.status} />
              <BranchBadge branch={campaign.branch} />
            </div>

            <p className="text-[13px] text-[color:var(--text-muted)]">
              {formatMeta(campaign)}
            </p>

            {/* 숫자 블록 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 pt-4">
              <Metric label="총 수신자" value={campaign.total_recipients} />
              <Metric
                label="도달"
                value={deliveredCount}
                suffix={
                  campaign.total_recipients > 0 ? ` (${reach}%)` : undefined
                }
                tone="success"
              />
              <Metric
                label="실패"
                value={failedCount}
                tone={failedCount > 0 ? "danger" : "default"}
              />
              <Metric
                label="비용"
                valueFormatted={`${campaign.total_cost.toLocaleString()}원`}
              />
            </div>

            {/* 발송·예약시각 */}
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 pt-2 text-[13px]">
              {campaign.sent_at && (
                <div>
                  <span className="text-[color:var(--text-muted)] mr-2">
                    발송시각
                  </span>
                  <span className="tabular-nums text-[color:var(--text)]">
                    {formatDateTime(campaign.sent_at)}
                  </span>
                </div>
              )}
              {campaign.scheduled_at && (
                <div>
                  <span className="text-[color:var(--text-muted)] mr-2">
                    예약시각
                  </span>
                  <span className="tabular-nums text-[color:var(--text)]">
                    {formatDateTime(campaign.scheduled_at)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* 우상단 액션 */}
          <div className="shrink-0">
            <ResendFailedButton
              campaignId={campaign.id}
              failedCount={failedCount}
            />
          </div>
        </div>
      </section>

      {/* 건별 메시지 */}
      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
            건별 발송 내역
          </h2>
          <p className="text-[12px] text-[color:var(--text-dim)]">
            수신번호는 개인정보 보호를 위해 일부 숨김 처리되어 있습니다.
          </p>
        </div>

        <CampaignMessagesTable rows={messages} />
      </section>
    </div>
  );
}

// ─── 내부 소 컴포넌트 ───────────────────────────────────────

function Metric({
  label,
  value,
  valueFormatted,
  suffix,
  tone = "default",
}: {
  label: string;
  value?: number;
  valueFormatted?: string;
  suffix?: string;
  tone?: "default" | "success" | "danger";
}) {
  const toneColor =
    tone === "success"
      ? "text-[color:var(--success)]"
      : tone === "danger"
        ? "text-[color:var(--danger)]"
        : "text-[color:var(--text)]";

  return (
    <div>
      <p className="text-[13px] text-[color:var(--text-muted)]">{label}</p>
      <p
        className={`mt-1 text-[22px] font-semibold tabular-nums leading-tight ${toneColor}`}
      >
        {valueFormatted ?? (value ?? 0).toLocaleString()}
        {suffix && (
          <span className="ml-1 text-[13px] font-normal text-[color:var(--text-muted)]">
            {suffix}
          </span>
        )}
      </p>
    </div>
  );
}

function formatMeta(c: CampaignListItem): string {
  const parts: string[] = [];
  parts.push(c.template_name ? `템플릿: ${c.template_name}` : "템플릿 없음");
  parts.push(c.group_name ? `그룹: ${c.group_name}` : "그룹 없음");
  return parts.join(" · ");
}

function formatDateTime(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return iso;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}
