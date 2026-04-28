"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { CalendarClock, Send } from "lucide-react";
import type { GroupListItem } from "@/types/database";
import type { PreviewResult } from "@/lib/messaging/preview-recipients";
import {
  scheduleAction,
  sendNowAction,
} from "@/app/(features)/compose/actions";
import type { ComposeStep2State } from "./compose-wizard";

/**
 * F3 Part B · Step 4 — 즉시 발송 / 예약 발송 + 최종 요약 + 결과 처리.
 *
 * - 라디오: "즉시" vs "예약"
 * - 예약 시 datetime-local 입력 (현재 이후만 허용 — 서버에서 한 번 더 검증).
 * - 발송 버튼 → sendNowAction / scheduleAction.
 * - 결과:
 *    success    → 성공 박스 + 캠페인 보기 링크
 *    scheduled  → 예약 박스 + 캠페인 보기 링크
 *    blocked    → 빨간 박스 + 미리보기로 되돌리기 버튼
 *    failed     → 빨간 박스 + 사유
 *    dev_seed_mode → 회색 안내 박스
 */
interface Props {
  groupId: string;
  selectedGroup: GroupListItem;
  step2: ComposeStep2State;
  preview: PreviewResult;
  title: string;
  scheduleAt: string | null;
  onScheduleAtChange: (v: string | null) => void;
  onBackToPreview: () => void;
}

type SendUiResult =
  | { kind: "success"; campaignId: string; sent: number; failed: number; cost: number }
  | { kind: "scheduled"; campaignId: string; scheduledAt: string }
  | { kind: "blocked"; reason: string }
  | { kind: "failed"; reason: string }
  | { kind: "dev_seed_mode"; reason: string };

export function ComposeStep4Send({
  groupId,
  selectedGroup,
  step2,
  preview,
  title,
  scheduleAt,
  onScheduleAtChange,
  onBackToPreview,
}: Props) {
  const [mode, setMode] = useState<"now" | "schedule">(
    scheduleAt ? "schedule" : "now",
  );
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<SendUiResult | null>(null);

  // 예약 모드일 때 datetime-local 의 min 값 (현재 시각 + 1분)
  const minScheduleAt = useMemo(() => toLocalDatetimeInput(new Date(Date.now() + 60_000)), []);

  const isReady = mode === "now" || (mode === "schedule" && !!scheduleAt);

  const onModeChange = (next: "now" | "schedule") => {
    setMode(next);
    setResult(null);
    if (next === "now") onScheduleAtChange(null);
  };

  const onSubmit = () => {
    if (!isReady) return;
    setResult(null);

    startTransition(async () => {
      if (mode === "now") {
        const r = await sendNowAction({
          step1: { groupId },
          step2: {
            templateId: step2.templateId,
            type: step2.type,
            subject: step2.subject,
            body: step2.body,
            isAd: step2.isAd,
          },
          step3: { title: title.trim() },
        });
        setResult(toUiResult(r));
      } else {
        // datetime-local → ISO (로컬 → UTC 자동 변환)
        if (!scheduleAt) return;
        const iso = new Date(scheduleAt).toISOString();
        const r = await scheduleAction({
          step1: { groupId },
          step2: {
            templateId: step2.templateId,
            type: step2.type,
            subject: step2.subject,
            body: step2.body,
            isAd: step2.isAd,
          },
          step3: { title: title.trim() },
          scheduleAt: iso,
        });
        setResult(toUiResult(r));
      }
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
          발송 시점
        </h2>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          지금 즉시 보내거나, 시간을 지정해 예약할 수 있습니다.
        </p>
      </div>

      {/* 모드 라디오 */}
      <fieldset className="space-y-2">
        <legend className="sr-only">발송 시점 선택</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label
            className={`
              flex items-start gap-3 p-3 rounded-lg border cursor-pointer
              transition-colors
              ${
                mode === "now"
                  ? "border-[color:var(--action)] bg-[color:var(--bg-muted)]"
                  : "border-[color:var(--border)] hover:bg-[color:var(--bg-hover)]"
              }
            `}
          >
            <input
              type="radio"
              name="compose-when"
              checked={mode === "now"}
              onChange={() => onModeChange("now")}
              className="mt-1 size-4 accent-[color:var(--action)]"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-[14px] font-medium text-[color:var(--text)]">
                즉시 발송
              </span>
              <span className="text-[12px] text-[color:var(--text-muted)]">
                지금 즉시 솔라피로 발송됩니다.
              </span>
            </span>
          </label>

          <label
            className={`
              flex items-start gap-3 p-3 rounded-lg border cursor-pointer
              transition-colors
              ${
                mode === "schedule"
                  ? "border-[color:var(--action)] bg-[color:var(--bg-muted)]"
                  : "border-[color:var(--border)] hover:bg-[color:var(--bg-hover)]"
              }
            `}
          >
            <input
              type="radio"
              name="compose-when"
              checked={mode === "schedule"}
              onChange={() => onModeChange("schedule")}
              className="mt-1 size-4 accent-[color:var(--action)]"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-[14px] font-medium text-[color:var(--text)]">
                예약 발송
              </span>
              <span className="text-[12px] text-[color:var(--text-muted)]">
                지정한 시각에 자동 발송됩니다.
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      {mode === "schedule" && (
        <div className="space-y-2">
          <div className="space-y-1.5">
            <label
              htmlFor="compose-schedule"
              className="text-[14px] font-medium text-[color:var(--text)]"
            >
              예약 시각
            </label>
            <input
              id="compose-schedule"
              type="datetime-local"
              value={scheduleAt ?? ""}
              min={minScheduleAt}
              onChange={(e) => onScheduleAtChange(e.target.value || null)}
              className="
                h-10 rounded-lg px-3
                bg-white border border-[color:var(--border)]
                text-[15px] text-[color:var(--text)]
                focus:outline-none focus:border-[color:var(--border-strong)]
              "
            />
          </div>
          <div
            role="note"
            className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-4 py-2.5 text-[13px] text-[color:var(--text-muted)]"
          >
            <CalendarClock
              className="inline size-3.5 mr-1 -mt-0.5"
              strokeWidth={1.75}
              aria-hidden
            />
            현재 MVP 는 예약 정보를 저장만 합니다. 실제 자동 발송은 Phase 1 의
            cron 연동 후 동작합니다.
          </div>
        </div>
      )}

      {/* 최종 요약 */}
      <section
        aria-label="발송 요약"
        className="rounded-lg border border-[color:var(--border)] p-4 grid grid-cols-2 sm:grid-cols-4 gap-4"
      >
        <Summary label="그룹" value={selectedGroup.name} />
        <Summary
          label="유형"
          value={step2.type === "ALIMTALK" ? "알림톡" : step2.type}
        />
        <Summary
          label="수신자"
          value={`${preview.recipientCount.toLocaleString("ko-KR")}명`}
        />
        <Summary
          label="비용"
          value={`${preview.cost.totalCost.toLocaleString("ko-KR")}원`}
        />
        <Summary
          label="발송 시점"
          value={
            mode === "now"
              ? "즉시"
              : scheduleAt
                ? formatScheduleDisplay(scheduleAt)
                : "—"
          }
        />
        <Summary label="캠페인 제목" value={title} className="col-span-2 sm:col-span-3" />
      </section>

      {/* 결과 박스 */}
      {result && <ResultBox result={result} onBack={onBackToPreview} />}

      {/* 발송 버튼 */}
      {!result && (
        <div className="flex items-center justify-end pt-2">
          <button
            type="button"
            onClick={onSubmit}
            disabled={!isReady || isPending}
            className="
              inline-flex items-center gap-1.5 h-10 px-6 rounded-lg
              bg-[color:var(--action)] text-[color:var(--action-text)]
              text-[14px] font-medium
              hover:bg-[color:var(--action-hover)]
              disabled:opacity-40 disabled:cursor-not-allowed
              transition-colors
            "
          >
            <Send className="size-4" strokeWidth={1.75} aria-hidden />
            {isPending
              ? "처리 중..."
              : mode === "now"
                ? "지금 발송"
                : "예약 등록"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── 결과 박스 ───────────────────────────────────────────────

function ResultBox({
  result,
  onBack,
}: {
  result: SendUiResult;
  onBack: () => void;
}) {
  if (result.kind === "success") {
    return (
      <div
        role="status"
        className="rounded-lg border border-[color:var(--success)] bg-[color:var(--success-bg)] p-4 space-y-2"
      >
        <p className="text-[14px] font-medium text-[color:var(--text)]">
          발송이 완료되었습니다.
        </p>
        <p className="text-[13px] text-[color:var(--text-muted)] tabular-nums">
          성공 {result.sent.toLocaleString("ko-KR")}건 · 실패{" "}
          {result.failed.toLocaleString("ko-KR")}건 · 비용{" "}
          {result.cost.toLocaleString("ko-KR")}원
        </p>
        <Link
          href={`/campaigns/${result.campaignId}`}
          className="
            inline-flex items-center h-10 px-4 rounded-lg
            bg-[color:var(--action)] text-[color:var(--action-text)]
            text-[14px] font-medium
            hover:bg-[color:var(--action-hover)]
            transition-colors
          "
        >
          캠페인 보기
        </Link>
      </div>
    );
  }
  if (result.kind === "scheduled") {
    return (
      <div
        role="status"
        className="rounded-lg border border-[color:var(--success)] bg-[color:var(--success-bg)] p-4 space-y-2"
      >
        <p className="text-[14px] font-medium text-[color:var(--text)]">
          예약이 등록되었습니다.
        </p>
        <p className="text-[13px] text-[color:var(--text-muted)]">
          예약 시각: {formatScheduleDisplay(result.scheduledAt)}
        </p>
        <Link
          href={`/campaigns/${result.campaignId}`}
          className="
            inline-flex items-center h-10 px-4 rounded-lg
            bg-[color:var(--action)] text-[color:var(--action-text)]
            text-[14px] font-medium
            hover:bg-[color:var(--action-hover)]
            transition-colors
          "
        >
          캠페인 보기
        </Link>
      </div>
    );
  }
  if (result.kind === "blocked") {
    return (
      <div
        role="alert"
        className="rounded-lg border border-[color:var(--danger)] bg-[color:var(--danger-bg)] p-4 space-y-2"
      >
        <p className="text-[14px] font-medium text-[color:var(--danger)]">
          발송이 차단되었습니다.
        </p>
        <p className="text-[13px] text-[color:var(--text)]">{result.reason}</p>
        <button
          type="button"
          onClick={onBack}
          className="
            inline-flex items-center h-10 px-4 rounded-lg
            border border-[color:var(--border)] bg-white
            text-[14px] text-[color:var(--text)]
            hover:bg-[color:var(--bg-hover)]
            transition-colors
          "
        >
          미리보기로 돌아가기
        </button>
      </div>
    );
  }
  if (result.kind === "failed") {
    return (
      <div
        role="alert"
        className="rounded-lg border border-[color:var(--danger)] bg-[color:var(--danger-bg)] p-4 space-y-1"
      >
        <p className="text-[14px] font-medium text-[color:var(--danger)]">
          발송에 실패했습니다.
        </p>
        <p className="text-[13px] text-[color:var(--text)]">{result.reason}</p>
      </div>
    );
  }
  // dev_seed_mode
  return (
    <div
      role="status"
      className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] p-4 text-[13px] text-[color:var(--text-muted)]"
    >
      {result.reason}
    </div>
  );
}

// ─── 작은 헬퍼 ───────────────────────────────────────────────

function Summary({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-[12px] text-[color:var(--text-muted)]">{label}</p>
      <p className="mt-0.5 text-[14px] font-medium text-[color:var(--text)] truncate">
        {value || "—"}
      </p>
    </div>
  );
}

function toLocalDatetimeInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatScheduleDisplay(input: string): string {
  // datetime-local 또는 ISO 모두 처리
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return input;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── Server Action 결과 → UI 결과 매핑 ─────────────────────────

import type { SendCampaignResult } from "@/lib/messaging/send-campaign";

function toUiResult(r: SendCampaignResult): SendUiResult {
  switch (r.status) {
    case "success":
      return {
        kind: "success",
        campaignId: r.campaignId,
        sent: r.sent,
        failed: r.failed,
        cost: r.cost,
      };
    case "scheduled":
      return {
        kind: "scheduled",
        campaignId: r.campaignId,
        scheduledAt: r.scheduledAt,
      };
    case "blocked":
      return { kind: "blocked", reason: r.reason };
    case "failed":
      return { kind: "failed", reason: r.reason };
    case "dev_seed_mode":
      return { kind: "dev_seed_mode", reason: r.reason };
  }
}
