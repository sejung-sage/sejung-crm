import type { CampaignStatus, MessageStatus } from "@/types/database";

/**
 * 캠페인 상태 배지.
 * 흑백 미니멀 · 상태는 색·외곽선·라벨 조합으로 구분 (색만으로 의미 전달 X).
 *
 *  - 완료    : 검정 배경 · 흰 글씨
 *  - 발송중  : 회색 점선 외곽선
 *  - 예약됨  : 회색 외곽선
 *  - 임시저장: 아주 연한 회색
 *  - 실패    : 빨간 외곽선
 *  - 취소    : 회색 · 취소선
 */
export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const style = styleFor(status);
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium"
      style={style.css}
    >
      {style.strike ? <span className="line-through">{status}</span> : status}
    </span>
  );
}

function styleFor(status: CampaignStatus): {
  css: React.CSSProperties;
  strike?: boolean;
} {
  switch (status) {
    case "완료":
      return {
        css: {
          backgroundColor: "var(--action)",
          color: "var(--action-text)",
        },
      };
    case "발송중":
      return {
        css: {
          backgroundColor: "var(--bg)",
          color: "var(--text-muted)",
          border: "1px dashed var(--border-strong)",
        },
      };
    case "예약됨":
      return {
        css: {
          backgroundColor: "var(--bg)",
          color: "var(--text-muted)",
          border: "1px solid var(--border-strong)",
        },
      };
    case "임시저장":
      return {
        css: {
          backgroundColor: "var(--bg-muted)",
          color: "var(--text-muted)",
        },
      };
    case "실패":
      return {
        css: {
          backgroundColor: "var(--danger-bg)",
          color: "var(--danger)",
          border: "1px solid var(--danger)",
        },
      };
    case "취소":
      return {
        css: {
          backgroundColor: "var(--bg-muted)",
          color: "var(--text-dim)",
        },
        strike: true,
      };
    default:
      return {
        css: {
          backgroundColor: "var(--bg-muted)",
          color: "var(--text-muted)",
        },
      };
  }
}

/**
 * 메시지 건별 상태 배지.
 *  - 도달: 성공톤 (연한 초록 배경 · 초록 텍스트)
 *  - 발송됨: 회색 외곽선 (전송 완료 · 도달 미확인)
 *  - 대기: 아주 연한 회색
 *  - 실패: 빨간 외곽선
 */
export function MessageStatusBadge({ status }: { status: MessageStatus }) {
  const css: React.CSSProperties = (() => {
    switch (status) {
      case "도달":
        return {
          backgroundColor: "var(--success-bg)",
          color: "var(--success)",
        };
      case "발송됨":
        return {
          backgroundColor: "var(--bg)",
          color: "var(--text-muted)",
          border: "1px solid var(--border-strong)",
        };
      case "대기":
        return {
          backgroundColor: "var(--bg-muted)",
          color: "var(--text-muted)",
        };
      case "실패":
        return {
          backgroundColor: "var(--danger-bg)",
          color: "var(--danger)",
          border: "1px solid var(--danger)",
        };
      default:
        return {
          backgroundColor: "var(--bg-muted)",
          color: "var(--text-muted)",
        };
    }
  })();
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium"
      style={css}
    >
      {status}
    </span>
  );
}
