import type { TemplateType } from "@/types/database";

/**
 * 템플릿 유형 배지 (SMS / LMS / 알림톡).
 * 흑백 미니멀 · 유형별 구분은 라벨 텍스트로만. 배경은 동일한 muted.
 */
export function TemplateTypeBadge({ type }: { type: TemplateType }) {
  const label =
    type === "SMS" ? "SMS" : type === "LMS" ? "LMS" : "알림톡";
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium tabular-nums"
      style={{
        backgroundColor: "var(--bg-muted)",
        color: "var(--text-muted)",
      }}
    >
      {label}
    </span>
  );
}

/**
 * 광고 여부 배지. is_ad=true 일 때만 표시.
 * 차분한 빨간 외곽선 + 회색 톤의 작은 라벨.
 */
export function AdBadge() {
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-medium border"
      style={{
        borderColor: "var(--danger)",
        color: "var(--danger)",
        backgroundColor: "var(--bg)",
      }}
      title="광고성 문자 — [광고] prefix · 080 수신거부 · 야간 차단 적용"
    >
      광고
    </span>
  );
}
