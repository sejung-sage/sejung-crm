import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { CampaignListItem, CampaignMessageRow } from "@/types/database";
import type { CampaignMessageCounts } from "@/lib/campaigns/get-campaign-message-counts";
import { BranchBadge } from "@/components/groups/branch-badge";
import { CampaignStatusBadge } from "@/components/campaigns/campaign-status-badge";
import { CampaignMessagesTable } from "@/components/campaigns/campaign-messages-table";
import { ResendFailedButton } from "@/components/campaigns/resend-failed-button";
import { ResumeStuckButton } from "@/components/campaigns/resume-stuck-button";
import { CancelScheduledButton } from "@/components/campaigns/cancel-scheduled-button";
import { RescheduleButton } from "@/components/campaigns/reschedule-button";
import { CampaignProgressPoller } from "@/components/campaigns/campaign-progress-poller";
import { formatKstDateTime } from "@/lib/datetime";

/**
 * F3-02 · 캠페인 상세 뷰 (Server Component).
 *
 * 구성:
 *  1. 브레드크럼 ← 문자 발송 내역
 *  2. 상단 카드: 제목 + 상태 + 메타(템플릿/그룹/분원) + 숫자블록 + 액션
 *  3. 건별 메시지 테이블 (상태 필터 칩 포함)
 *
 * 진행률 카운트:
 *  - getCampaignMessageCounts() 의 head 쿼리 결과(props.counts)를 신뢰.
 *  - status='발송중' 동안 CampaignProgressPoller 가 5초마다 router.refresh().
 */
interface Props {
  campaign: CampaignListItem;
  messages: CampaignMessageRow[];
  counts: CampaignMessageCounts;
  /** 학부모 연락처 풀 노출 권한. master 만 true. */
  canRevealPhone?: boolean;
  /** 행별 재발송 권한. 해당 분원 캠페인 발송 권한과 동일. */
  canResend?: boolean;
}

export function CampaignDetailView({
  campaign,
  messages,
  counts,
  canRevealPhone = false,
  canResend = false,
}: Props) {
  const isInFlight = campaign.status === "발송중";
  const isScheduled = campaign.status === "예약됨";

  // 접수 성공 = sendon 큐에 들어간 건수 (vendor 응답 status=queued)
  // sendon webhook/polling 미구현이라 "도달" 통계는 보유 X.
  const successCount = counts.발송됨;
  const failedCount = counts.실패;
  const pendingCount = counts.대기;
  // 분모는 항상 캠페인 적재 시점의 total_recipients (드레인 진행 중에도 고정).
  const denominator = campaign.total_recipients;
  const successRate =
    denominator > 0 ? Math.round((successCount / denominator) * 100) : 0;

  return (
    <div className="max-w-7xl space-y-6">
      {/* 발송중일 때만 폴링 — status 변경 시 자동 중단. 진행률이 더 또렷하게
          갱신되도록 3초 간격(대량 발송이 수십 초~분 단위로 끝남). */}
      <CampaignProgressPoller status={campaign.status} intervalMs={3000} />

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
        className="rounded-xl border border-[color:var(--border)] bg-bg-card p-6"
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

            {/* 숫자 블록 — 발송중에는 대기 카운트, 완료/실패 후엔 비용 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 pt-4">
              <Metric label="총 수신자" value={campaign.total_recipients} />
              <Metric
                label="성공"
                value={successCount}
                suffix={
                  denominator > 0 ? ` (${successRate}%)` : undefined
                }
                tone="success"
              />
              <Metric
                label="실패"
                value={failedCount}
                tone={failedCount > 0 ? "danger" : "default"}
              />
              {isInFlight ? (
                <Metric
                  label="발송 대기"
                  value={pendingCount}
                  tone={pendingCount > 0 ? "default" : "success"}
                  suffix={pendingCount > 0 ? " 건 남음" : undefined}
                />
              ) : (
                <Metric
                  label="비용"
                  valueFormatted={`${campaign.total_cost.toLocaleString()}원`}
                />
              )}
            </div>

            {isInFlight && (
              <p className="text-[12px] text-[color:var(--text-muted)]">
                발송이 진행 중입니다. 화면이 5초마다 자동 갱신됩니다.
              </p>
            )}

            {/* 발송·예약시각 + 발송자 */}
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
              <div>
                <span className="text-[color:var(--text-muted)] mr-2">
                  발송자
                </span>
                <span className="text-[color:var(--text)]">
                  {campaign.creator_name ?? "—"}
                </span>
              </div>
            </div>
          </div>

          {/* 우상단 액션 */}
          <div className="shrink-0 flex flex-col items-end gap-2">
            {isScheduled && canResend ? (
              <>
                <RescheduleButton campaignId={campaign.id} />
                <CancelScheduledButton campaignId={campaign.id} />
              </>
            ) : (
              <>
                {isInFlight && pendingCount > 0 && (
                  <ResumeStuckButton
                    campaignId={campaign.id}
                    pendingCount={pendingCount}
                  />
                )}
                <ResendFailedButton
                  campaignId={campaign.id}
                  failedCount={failedCount}
                />
              </>
            )}
          </div>
        </div>
      </section>

      {/* 발송 내용 (본문 + 제목 + 유형) — 2026-05-22 운영자 요청 추가.
          학생 발송 이력의 펼침 영역과 동일 패턴. */}
      <section
        className="rounded-xl border border-[color:var(--border)] bg-bg-card p-6 space-y-4"
        aria-label="발송 내용"
      >
        <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
          발송 내용
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-[14px]">
          <dt className="text-[13px] text-[color:var(--text-muted)] pt-0.5 whitespace-nowrap">
            유형
          </dt>
          <dd className="min-w-0 flex items-center gap-2">
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-md text-[12px] font-medium border bg-[color:var(--bg-muted)] text-[color:var(--text)] border-[color:var(--border-strong)]"
            >
              {campaign.type ?? "—"}
            </span>
            {campaign.is_ad && (
              <span
                className="inline-flex items-center whitespace-nowrap px-1.5 py-0.5 rounded-md text-[11px] font-medium border"
                style={{
                  borderColor: "var(--danger)",
                  color: "var(--danger)",
                  backgroundColor: "var(--bg)",
                }}
              >
                광고
              </span>
            )}
          </dd>

          {campaign.subject && (
            <>
              <dt className="text-[13px] text-[color:var(--text-muted)] pt-0.5 whitespace-nowrap">
                제목
              </dt>
              <dd className="min-w-0 text-[color:var(--text)]">
                {campaign.subject}
              </dd>
            </>
          )}

          <dt className="text-[13px] text-[color:var(--text-muted)] pt-0.5 whitespace-nowrap">
            본문
          </dt>
          <dd className="min-w-0">
            {campaign.body ? (
              <p className="whitespace-pre-wrap leading-relaxed text-[color:var(--text)]">
                {campaign.body}
              </p>
            ) : (
              <p className="text-[color:var(--text-muted)]">본문 정보 없음</p>
            )}
          </dd>
        </dl>
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

        <CampaignMessagesTable
          rows={messages}
          counts={counts}
          canRevealPhone={canRevealPhone}
          canResend={canResend}
        />
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

// KST 포맷터로 위임. Supabase timestamptz 는 UTC ISO 라서
// 옛 substring 방식은 UTC 시각이 그대로 노출되는 버그가 있었다.
function formatDateTime(iso: string): string {
  return formatKstDateTime(iso);
}
