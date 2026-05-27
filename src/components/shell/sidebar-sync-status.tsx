import { RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import type { EtlSyncRunRow } from "@/types/database";

/**
 * 사이드바 하단 "마지막 동기화" 표시 (시계 옆).
 *
 * - 매시간 ETL(run_all.bat)이 etl_sync_runs 에 남긴 최신 1건을 보여준다.
 * - 시각(KST) + 성공/실패 상태. 건수는 표시하지 않음(사용자 결정 2026-05-27).
 * - Server Component — 절대 시각이라 클라이언트 틱 불필요. finished_at 은
 *   서버에서 Asia/Seoul 로 포맷.
 * - 기록이 없으면(최초 셋업 직후 등) "기록 없음".
 */
export function SidebarSyncStatus({ run }: { run: EtlSyncRunRow | null }) {
  const ok = run?.status === "success";

  return (
    <div
      className="
        flex items-center gap-2 px-3 py-2 rounded-lg
        bg-[color:var(--bg-muted)]
        text-[13px] text-[color:var(--text-muted)]
      "
      aria-label="마지막 데이터 동기화"
    >
      <RefreshCw
        className="size-4 shrink-0 text-[color:var(--text-dim)]"
        strokeWidth={1.75}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] leading-tight text-[color:var(--text-dim)]">
          마지막 동기화
        </div>
        {run ? (
          <span className="tabular-nums text-[color:var(--text)] font-medium leading-tight truncate block">
            {formatKstSync(run.finished_at)}
          </span>
        ) : (
          <span className="text-[color:var(--text-muted)] leading-tight">기록 없음</span>
        )}
      </div>

      {run && (
        <span
          className="inline-flex items-center gap-1 shrink-0 text-[12px] font-medium"
          title={ok ? "정상 동기화" : (run.error_message ?? "동기화 실패")}
        >
          {ok ? (
            <>
              <CheckCircle2
                className="size-3.5"
                style={{ color: "var(--success)" }}
                strokeWidth={2}
                aria-hidden
              />
              <span style={{ color: "var(--success)" }}>정상</span>
            </>
          ) : (
            <>
              <AlertTriangle
                className="size-3.5"
                style={{ color: "var(--danger)" }}
                strokeWidth={2}
                aria-hidden
              />
              <span style={{ color: "var(--danger)" }}>실패</span>
            </>
          )}
        </span>
      )}
    </div>
  );
}

/**
 * Asia/Seoul 기준 "M월 D일 오전/오후 H:MM" 라벨.
 * 사이드바 시계(sidebar-clock)와 동일 톤 — 40~60대 가독성 위해 오전/오후 표기.
 */
function formatKstSync(iso: string): string {
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
