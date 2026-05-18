/**
 * 학생 분원 배지.
 *
 * 학생 row 의 이름 옆 등에 부착하여 "이 학생이 어느 분원 소속" 을 시각적으로
 * 즉시 식별. master 가 '전체' 로 다중 분원을 볼 때 row 가 섞이는 인지 부담을
 * 줄이고, admin/manager/viewer 가 자기 분원만 보는 환경에서도 일관된 시각.
 *
 * 디자인: 흰색+검정 미니멀. 작은 배지(11px) + bg-muted + text-muted.
 */
export function BranchBadge({ branch }: { branch: string }) {
  if (!branch || branch.trim().length === 0) return null;
  return (
    <span
      aria-label={`소속 분원: ${branch}`}
      className="
        inline-flex items-center
        px-1.5 py-0.5 rounded
        bg-[color:var(--bg-muted)]
        text-[color:var(--text-muted)]
        text-[11px] font-medium leading-none
        tabular-nums
        align-middle
      "
    >
      {branch}
    </span>
  );
}
