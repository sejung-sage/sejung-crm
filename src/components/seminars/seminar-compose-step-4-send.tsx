"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  Send,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  CalendarClock,
} from "lucide-react";
import type { ClassSignupOption } from "@/types/database";
import type { GroupFilters } from "@/lib/schemas/group";
import type { Division } from "@/config/divisions";
import {
  SCHEDULE_MIN_LEAD_MS,
  SCHEDULE_MIN_LEAD_LABEL,
} from "@/lib/messaging/schedule-window";
import { formatKstDateTime } from "@/lib/datetime";
import { createSeminarBroadcastAction } from "@/app/(features)/seminars/actions";
import type { SeminarComposeState } from "./seminar-compose-wizard";

/**
 * F5 · 설명회 발송 — 하단 발송 바.
 *
 * 2026-06-16 개편: 일반 SMS /compose 의 하단 발송 바와 동일한 모양으로 통일.
 * 옛 "발송 요약 카드 + 발송 확인" 단계 박스를 버리고, 즉시/예약 선택 + 대상 N명
 * + 발송 버튼을 한 줄 바로 합쳤다. 미충족 항목이 있으면 버튼을 비활성화하고
 * 인라인 체크리스트로 안내한다(확인 다이얼로그에서 최종 요약).
 *
 * - 확인 다이얼로그 → createSeminarBroadcastAction(filters + branch).
 * - 결과:
 *    success → 캠페인 페이지로 이동 (campaign_id).
 *    dev_seed_mode → 회색 안내 박스.
 *    blocked / failed → 경고 박스 + 사유.
 */
interface Props {
  state: SeminarComposeState;
  selectedClasses: ClassSignupOption[];
  /** 대상 필터(체크 해제분 = excludeStudentIds 포함). 발송 액션에 그대로 전달. */
  filters: GroupFilters;
  /** 체크된 대상 학생 수(대상 표시·확인 다이얼로그용). */
  recipientCount: number;
  branch: string;
  /** 발신 명의(division) — 발송 payload 로 전달(서버가 발신번호·표시명 해석). */
  senderDivision: Division;
  /** 발송 활성 여부 — 부모(wizard)가 계산. false 면 버튼 비활성 + 체크리스트 노출. */
  readyToSend: boolean;
  /** 미충족 항목 목록(체크리스트). readyToSend=false 일 때만 의미. */
  missing: string[];
}

type SendUiResult =
  | {
      kind: "success";
      campaignId: string;
      queued: number;
      scheduledAt: string | null;
    }
  | { kind: "blocked"; reason: string }
  | { kind: "dev_seed_mode"; reason: string }
  | { kind: "failed"; reason: string };

/** Date → datetime-local 값(YYYY-MM-DDTHH:mm), 로컬 시간 기준. */
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function SeminarComposeStep4Send({
  state,
  selectedClasses,
  filters,
  recipientCount,
  branch,
  senderDivision,
  readyToSend,
  missing,
}: Props) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<SendUiResult | null>(null);
  const [mode, setMode] = useState<"now" | "schedule">("now");
  const [scheduleAt, setScheduleAt] = useState("");
  // 예약 최소 리드타임(5분 후). 5~30분은 자체 지연발송, 30분 이상은 sendon 네이티브.
  const minScheduleAt = useMemo(
    () => toLocalInput(new Date(Date.now() + SCHEDULE_MIN_LEAD_MS)),
    [],
  );
  const canSend =
    readyToSend && (mode === "now" || (mode === "schedule" && !!scheduleAt));

  const handleSend = () => {
    setConfirmOpen(false);
    const scheduledIso =
      mode === "schedule" && scheduleAt
        ? new Date(scheduleAt).toISOString()
        : null;
    startTransition(async () => {
      // backend `createSeminarBroadcastAction` — filters + branch 전달(그룹 없이
      // 필터로 직접 발송). 학생 펼침은 서버 내부 `loadRecipientsByFilters` 가
      // 처리(URL 414 회피). 체크 해제한 학생은 filters.excludeStudentIds 로 실려
      // 발송에서 빠진다.
      const res = await createSeminarBroadcastAction({
        class_ids: state.selectedClassIds,
        filters,
        body: state.body,
        subject: state.type === "LMS" ? state.subject : null,
        type: state.type,
        branch,
        senderDivision,
        is_ad: state.isAd,
        allow_multiple: state.allowMultiple,
        scheduled_at: scheduledIso,
      });

      switch (res.status) {
        case "success":
          // 비동기 발송 — 큐 적재만 끝났고 실제 발송은 백그라운드 드레인이 진행한다.
          setResult({
            kind: "success",
            campaignId: res.campaign_id,
            queued: res.queued,
            scheduledAt: res.scheduledAt ?? null,
          });
          router.push(`/campaigns/${res.campaign_id}`);
          break;
        case "blocked":
          setResult({
            kind: "blocked",
            reason: res.reason ?? "발송 가드에 의해 차단되었습니다",
          });
          break;
        case "dev_seed_mode":
          setResult({
            kind: "dev_seed_mode",
            reason: `개발 시드 모드입니다. 실제 발송과 invitation 생성은 일어나지 않았습니다 (예상 ${res.invitation_count.toLocaleString()}건).`,
          });
          break;
        case "failed":
          setResult({
            kind: "failed",
            reason: res.reason ?? "발송에 실패했습니다",
          });
          break;
      }
    });
  };

  return (
    <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-muted)] p-5 space-y-4">
      {/* 결과 박스 */}
      {result && <ResultBox result={result} onDismiss={() => setResult(null)} />}

      {/* 발송 시점 (즉시 / 예약) */}
      {!result && (
        <>
          <fieldset className="flex flex-wrap items-center gap-3">
            <legend className="sr-only">발송 시점</legend>
            <label className="flex items-center gap-2 cursor-pointer text-[14px] text-[color:var(--text)]">
              <input
                type="radio"
                name="seminar-send-mode"
                checked={mode === "now"}
                onChange={() => {
                  setMode("now");
                  setScheduleAt("");
                }}
                className="size-4 accent-[color:var(--action)]"
              />
              즉시 발송
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-[14px] text-[color:var(--text)]">
              <input
                type="radio"
                name="seminar-send-mode"
                checked={mode === "schedule"}
                onChange={() => setMode("schedule")}
                className="size-4 accent-[color:var(--action)]"
              />
              예약 발송
            </label>
            {mode === "schedule" && (
              <input
                type="datetime-local"
                value={scheduleAt}
                min={minScheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
                aria-label="예약 시각"
                className="h-10 rounded-lg px-3 bg-bg-card border border-[color:var(--border)] text-[15px] text-[color:var(--text)] focus:outline-none focus:border-[color:var(--border-strong)]"
              />
            )}
          </fieldset>

          {mode === "schedule" && (
            <p className="flex items-start gap-1.5 text-[12px] text-[color:var(--text-muted)]">
              <CalendarClock
                className="size-3.5 mt-0.5 shrink-0"
                strokeWidth={1.75}
                aria-hidden
              />
              최소 {SCHEDULE_MIN_LEAD_LABEL} 이후로 예약할 수 있고, 예약 후
              캠페인 상세에서 취소·변경할 수 있어요.
            </p>
          )}

          {/* 미충족 항목 체크리스트 */}
          {!readyToSend && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-lg border border-dashed border-[color:var(--border-strong)] bg-bg-card p-4"
            >
              <AlertCircle
                className="size-4 mt-0.5 shrink-0 text-[color:var(--text-muted)]"
                strokeWidth={1.75}
                aria-hidden
              />
              <div className="text-[13px] text-[color:var(--text-muted)] space-y-1">
                <p>발송 전에 아래 항목을 채워주세요.</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  {missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-4 flex-wrap pt-1">
            <div className="text-[15px] text-[color:var(--text)]">
              발송 대상{" "}
              <strong className="tabular-nums text-[18px]">
                {recipientCount.toLocaleString("ko-KR")}명
              </strong>
              <span className="ml-3 text-[13px] text-[color:var(--text-muted)]">
                탈퇴·수신거부·번호 결측은 발송 시 자동 제외
              </span>
            </div>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={!canSend || isPending}
              className="inline-flex items-center gap-1.5 h-11 px-6 rounded-lg bg-[color:var(--action)] text-[color:var(--action-text)] text-[15px] font-medium hover:bg-[color:var(--action-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {mode === "schedule" ? (
                <CalendarClock
                  className="size-4"
                  strokeWidth={1.75}
                  aria-hidden
                />
              ) : (
                <Send className="size-4" strokeWidth={1.75} aria-hidden />
              )}
              {isPending
                ? "처리 중..."
                : mode === "schedule"
                  ? "예약 등록"
                  : "지금 발송"}
            </button>
          </div>
        </>
      )}

      {/* 확인 다이얼로그 */}
      {confirmOpen && (
        <ConfirmDialog
          onCancel={() => setConfirmOpen(false)}
          onConfirm={handleSend}
          summary={{
            seminarCount: selectedClasses.length,
            recipientCount,
          }}
        />
      )}
    </div>
  );
}

// ─── 결과 박스 ──────────────────────────────────────────────

function ResultBox({
  result,
  onDismiss,
}: {
  result: SendUiResult;
  onDismiss: () => void;
}) {
  if (result.kind === "success") {
    return (
      <div
        role="status"
        className="rounded-xl border border-[color:var(--success)] bg-[color:var(--success-bg)] p-5 space-y-3"
      >
        <div className="flex items-center gap-2">
          <CheckCircle2
            className="size-5 text-[color:var(--success)]"
            strokeWidth={1.75}
            aria-hidden
          />
          <h3 className="text-[15px] font-semibold text-[color:var(--text)]">
            {result.scheduledAt ? "예약되었습니다" : "발송을 시작했습니다"}
          </h3>
        </div>
        <p className="text-[13px] text-[color:var(--text-muted)] tabular-nums">
          {result.scheduledAt
            ? `${result.queued.toLocaleString()}건이 ${formatKstDateTime(result.scheduledAt)} 에 발송되도록 예약되었습니다. 발송 전까지 캠페인 상세에서 취소·변경할 수 있어요.`
            : `${result.queued.toLocaleString()}건이 발송 대기열에 적재되었습니다. 진행 상황은 캠페인 상세에서 실시간으로 확인할 수 있습니다.`}
        </p>
        <Link
          href={`/campaigns/${result.campaignId}`}
          className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-[color:var(--action)] text-[color:var(--action-text)] text-[14px] font-medium hover:bg-[color:var(--action-hover)] transition-colors"
        >
          발송 진행 상황 보기
        </Link>
      </div>
    );
  }
  if (result.kind === "dev_seed_mode") {
    return (
      <div
        role="note"
        className="rounded-xl border border-[color:var(--border-strong)] bg-bg-card p-5"
      >
        <p className="text-[14px] text-[color:var(--text-muted)]">
          {result.reason}
        </p>
      </div>
    );
  }
  const isBlocked = result.kind === "blocked";
  return (
    <div
      role="alert"
      className={`rounded-xl border p-5 space-y-3 ${
        isBlocked
          ? "border-[color:var(--warning)] bg-[color:var(--warning-bg)]"
          : "border-[color:var(--danger)] bg-[color:var(--danger-bg)]"
      }`}
    >
      <div className="flex items-center gap-2">
        <AlertTriangle
          className={`size-5 ${
            isBlocked
              ? "text-[color:var(--warning)]"
              : "text-[color:var(--danger)]"
          }`}
          strokeWidth={1.75}
          aria-hidden
        />
        <h3 className="text-[15px] font-semibold text-[color:var(--text)]">
          {isBlocked ? "발송이 차단되었습니다" : "발송에 실패했습니다"}
        </h3>
      </div>
      <p className="text-[13px] text-[color:var(--text)]">{result.reason}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="inline-flex items-center h-10 px-4 rounded-lg border border-[color:var(--border-strong)] bg-bg-card text-[14px] text-[color:var(--text)] hover:bg-[color:var(--bg-hover)] transition-colors"
      >
        다시 작성
      </button>
    </div>
  );
}

// ─── 확인 다이얼로그 ──────────────────────────────────────

function ConfirmDialog({
  onCancel,
  onConfirm,
  summary,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  summary: { seminarCount: number; recipientCount: number };
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="seminar-broadcast-confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-xl bg-bg-card border border-[color:var(--border-strong)] p-6 space-y-4">
        <h3
          id="seminar-broadcast-confirm-title"
          className="text-[17px] font-semibold text-[color:var(--text)]"
        >
          지금 발송할까요?
        </h3>
        <div className="rounded-lg bg-[color:var(--bg-muted)] p-3 text-[13px] text-[color:var(--text)] space-y-1">
          <div>
            설명회 <strong>{summary.seminarCount}</strong>개
          </div>
          <div className="tabular-nums">
            대상 학생 약 <strong>{summary.recipientCount.toLocaleString()}</strong>명
          </div>
        </div>
        <p className="text-[13px] text-[color:var(--text-muted)] leading-relaxed">
          발송 후에는 학생별 신청 페이지가 즉시 활성화됩니다. 학생별 초대 행은
          취소할 수 없으니 본문과 대상을 한 번 더 확인해 주세요.
        </p>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center h-10 px-4 rounded-lg border border-[color:var(--border)] bg-bg-card text-[14px] text-[color:var(--text)] hover:bg-[color:var(--bg-hover)] transition-colors"
          >
            취소
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex items-center h-10 px-5 rounded-lg bg-[color:var(--action)] text-[color:var(--action-text)] text-[14px] font-semibold hover:bg-[color:var(--action-hover)] transition-colors"
          >
            확인하고 발송
          </button>
        </div>
      </div>
    </div>
  );
}
