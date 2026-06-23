/**
 * 캠페인 제목 자동 생성.
 *
 * 운영자가 작성 화면에서 "캠페인 제목"을 일일이 안 쓰도록(2026-06-23 요청), 본문에서
 * 제목을 파생한다. 제목은 수신자에게 노출되지 않는 내부 관리용 — 캠페인 목록·상세에서
 * "아 그 문자" 하고 알아보는 용도라, 본문 첫 줄 앞부분이면 충분하다.
 *
 * 규칙:
 *   - 본문의 첫 "비어있지 않은" 줄을 trim 해 앞 MAX_LEN 자.
 *   - 잘리면 끝에 "…".
 *   - 본문이 비었거나 공백뿐이면 "무제 캠페인".
 *   - {이름}·{날짜} 같은 토큰은 그대로 둔다(내부용이라 치환 불필요).
 *
 * 순수 함수. 외부 IO 없음.
 */

const MAX_LEN = 30;

export function deriveCampaignTitle(body: string): string {
  const firstLine = body
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);

  if (!firstLine) return "무제 캠페인";
  return firstLine.length > MAX_LEN
    ? `${firstLine.slice(0, MAX_LEN)}…`
    : firstLine;
}
