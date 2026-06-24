/**
 * 캠페인 상세 우상단 액션 버튼 공통 스타일.
 *
 * 버튼들이 높이(h-9/h-10)·색(검정/회색/빨강)이 제각각이라 클루지했던 것을 통일(2026-06-24).
 * 같은 크기·폭(컨테이너가 w 고정 + 버튼 w-full)으로 가지런히 정렬하고, 색은 위계만:
 *   - default : 회색 아웃라인(대부분의 보조 액션)
 *   - danger  : 빨강 아웃라인(예약 취소 등 되돌리기 어려운 동작)
 */

const ACTION_BTN_BASE =
  "inline-flex items-center justify-center gap-1.5 w-full h-9 px-3 rounded-lg " +
  "text-[13px] font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

export const ACTION_BTN_DEFAULT =
  `${ACTION_BTN_BASE} bg-bg-card border border-[color:var(--border-strong)] ` +
  "text-[color:var(--text)] hover:bg-[color:var(--bg-hover)]";

export const ACTION_BTN_DANGER =
  `${ACTION_BTN_BASE} bg-bg-card border border-[color:var(--danger)] ` +
  "text-[color:var(--danger)] hover:bg-[color:var(--danger-bg)]";
