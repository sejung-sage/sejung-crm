/**
 * 예약 발송 시각 표시 헬퍼 (단일 소스).
 *
 * 왜 오전/오후 표기인가:
 *   예약 입력이 `<input type="datetime-local">` 이라 브라우저 UI 가 오전/오후
 *   선택식이다. 확인 화면이 24시간 표기(`2026-08-21 23:01`)로 되비추면
 *   "오전 11시로 걸었다고 생각했는데 오후 11시" 같은 착오가 눈에 안 들어온다
 *   (운영 요청 2026-08-20). 입력과 같은 어법으로 되읽어 줘야 착오가 잡힌다.
 *   요일도 함께 박아 날짜 착오까지 거른다.
 *
 * 확인 다이얼로그와 예약 완료 안내가 같은 문자열을 쓰도록 여기로 모았다
 * (각 컴포넌트에 복사돼 있던 것을 합침 — 한쪽만 고쳐 어긋나는 것 방지).
 */

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

/**
 * `2026년 8월 21일 (금) 오전 11:01` 형태.
 * 파싱 불가한 입력은 원문 그대로 돌려준다(표시 전용이라 던지지 않는다).
 */
export function formatScheduleDisplay(scheduleAt: string): string {
  const d = new Date(scheduleAt);
  if (Number.isNaN(d.getTime())) return scheduleAt;

  const h24 = d.getHours();
  const ampm = h24 < 12 ? "오전" : "오후";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(d.getMinutes()).padStart(2, "0");

  return (
    `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ` +
    `(${WEEKDAYS[d.getDay()]}) ${ampm} ${h12}:${mm}`
  );
}

/**
 * 예약 시각이 야간(21시~08시)인지.
 *
 * 오전/오후를 잘못 고른 대표 증상이 "밤 시간대 예약" 이다. 광고 문자는 서버가
 * 21~08시를 차단하지만(발송 안전 가드) 비광고는 그대로 나가므로, 확정 전에
 * 눈에 띄게 알리는 용도.
 */
export function isNightSchedule(scheduleAt: string): boolean {
  const d = new Date(scheduleAt);
  if (Number.isNaN(d.getTime())) return false;
  const h = d.getHours();
  return h >= 21 || h < 8;
}
