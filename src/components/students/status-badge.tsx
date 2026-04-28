import type { StudentStatus } from "@/types/database";

/**
 * 재원 상태 배지 (F1-01 목록 · F1-02 상세 공통).
 * 색상 매핑은 CSS 변수 기반. 값 하드코딩 금지.
 */
export function StudentStatusBadge({ status }: { status: StudentStatus | string }) {
  const style = (() => {
    switch (status) {
      case "재원생":
        return {
          bg: "var(--success-bg)",
          fg: "var(--success)",
        };
      case "수강이력자":
        return {
          bg: "var(--bg-muted)",
          fg: "var(--text-muted)",
        };
      case "신규리드":
        return {
          bg: "var(--info-bg)",
          fg: "var(--info)",
        };
      case "탈퇴":
        return {
          bg: "var(--bg-muted)",
          fg: "var(--text-dim)",
        };
      default:
        return {
          bg: "var(--bg-muted)",
          fg: "var(--text-muted)",
        };
    }
  })();

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[13px] font-medium"
      style={{
        backgroundColor: style.bg,
        color: style.fg,
      }}
    >
      {status}
    </span>
  );
}
