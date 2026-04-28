/**
 * 분원 배지.
 * 흑백 미니멀 톤 · 분원마다 배경을 다르게 주지 않고 동일한 muted 톤으로 통일.
 */
export function BranchBadge({ branch }: { branch: string }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium"
      style={{
        backgroundColor: "var(--bg-muted)",
        color: "var(--text-muted)",
      }}
    >
      {branch}
    </span>
  );
}
