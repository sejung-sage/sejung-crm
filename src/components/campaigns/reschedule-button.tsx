"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, CalendarClock } from "lucide-react";
import { rescheduleCampaignAction } from "@/app/(features)/campaigns/actions";
import {
  formatScheduleDisplay,
  isNightSchedule,
} from "@/lib/messaging/format-schedule";
import { ACTION_BTN_DEFAULT } from "./action-button-styles";

/**
 * 예약 시각 변경 버튼 — status='예약됨' 캠페인에서만 노출.
 *
 * sendon 은 예약 수정을 미지원하므로 서버가 "취소 후 재예약"으로 처리한다.
 * 클릭 → datetime-local 입력 → rescheduleCampaignAction.
 *
 * 고른 시각은 입력과 같은 어법(오전/오후 + 요일)으로 되읽어 준다 — 24시간 표기로는
 * 오전/오후 착오가 눈에 안 들어온다(운영 요청 2026-08-20). 밤 시간대면 경고까지.
 */
interface Props {
  campaignId: string;
}

/** Date → datetime-local input 값(YYYY-MM-DDTHH:mm), 로컬 시간 기준. */
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function RescheduleButton({ campaignId }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // 최소 30분 이후(sendon 제약).
  const minValue = useMemo(
    () => toLocalInput(new Date(Date.now() + 30 * 60_000)),
    [],
  );

  const onSubmit = () => {
    setError(null);
    if (!value) {
      setError("새 예약 시각을 선택하세요");
      return;
    }
    const iso = new Date(value).toISOString();
    startTransition(async () => {
      const r = await rescheduleCampaignAction(campaignId, iso);
      if (r.status === "rescheduled") {
        setOpen(false);
        router.refresh();
      } else if (r.status === "dev_seed_mode") {
        setError(r.reason);
      } else {
        setError(r.reason);
      }
    });
  };

  return (
    <div className="flex flex-col items-stretch gap-2">
      <button
        type="button"
        onClick={() => {
          setError(null);
          setValue("");
          setOpen(true);
        }}
        className={ACTION_BTN_DEFAULT}
      >
        <CalendarClock className="size-4" strokeWidth={1.75} aria-hidden />
        예약 시각 변경
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reschedule-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/20"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isPending) setOpen(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !isPending) setOpen(false);
          }}
        >
          <div className="w-full max-w-md rounded-xl bg-bg-card border border-[color:var(--border)] shadow-lg p-6 space-y-4">
            <h3
              id="reschedule-title"
              className="text-[18px] font-semibold text-[color:var(--text)]"
            >
              예약 시각 변경
            </h3>
            <p className="text-[13px] text-[color:var(--text-muted)] leading-relaxed">
              기존 예약을 취소하고 새 시각으로 다시 예약합니다. 최소 30분 이후로
              선택하세요.
            </p>
            <input
              type="datetime-local"
              value={value}
              min={minValue}
              onChange={(e) => setValue(e.target.value)}
              className="
                w-full h-11 rounded-lg px-3
                bg-bg-card border border-[color:var(--border)]
                text-[15px] text-[color:var(--text)]
                focus:outline-none focus:border-[color:var(--border-strong)]
              "
            />
            {value && (
              <p className="text-[14px] text-[color:var(--text)]">
                <span className="text-[color:var(--text-muted)] mr-2">
                  변경할 시각
                </span>
                <strong className="font-medium">
                  {formatScheduleDisplay(value)}
                </strong>
              </p>
            )}
            {value && isNightSchedule(value) && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-[color:var(--warning)] px-3 py-2 text-[13px] leading-relaxed text-[color:var(--text)]"
              >
                <AlertTriangle
                  className="size-4 mt-0.5 shrink-0 text-[color:var(--warning)]"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span className="min-w-0">
                  밤 시간대로 예약됩니다. 오전/오후를 잘못 고르지 않았는지 확인해
                  주세요.
                </span>
              </p>
            )}
            {error && (
              <p role="alert" className="text-[13px] text-[color:var(--danger)]">
                {error}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={isPending}
                className="
                  inline-flex items-center h-10 px-4 rounded-lg
                  border border-[color:var(--border)] bg-bg-card
                  text-[14px] text-[color:var(--text)]
                  hover:bg-[color:var(--bg-hover)] disabled:opacity-50 transition-colors
                "
              >
                돌아가기
              </button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={isPending}
                className="
                  inline-flex items-center h-10 px-5 rounded-lg
                  bg-[color:var(--action)] text-[color:var(--action-text)]
                  text-[14px] font-medium
                  hover:bg-[color:var(--action-hover)] disabled:opacity-50 transition-colors
                "
              >
                {isPending ? "변경 중..." : "변경"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
