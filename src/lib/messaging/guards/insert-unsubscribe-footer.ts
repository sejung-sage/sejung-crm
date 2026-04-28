/**
 * 광고성 메시지 본문 끝에 `무료수신거부 {080번호}` footer 를 자동 삽입.
 *
 * 규약:
 *   - `isAd === false` 면 원문 그대로 반환.
 *   - 이미 본문에 "무료수신거부" 문자열이 포함되어 있으면 스킵(중복 삽입 금지).
 *   - 080 번호 우선순위: 인자 > 환경변수 `SMS_OPT_OUT_NUMBER` > `080-123-4567` (기본값).
 *   - 본문과 footer 사이에는 개행 1개.
 *
 * 이 함수는 순수 함수이되 환경변수를 **인자가 없을 때만** 참조한다.
 * 테스트에서는 `optOutNumber` 를 직접 전달하면 env 와 독립 검증 가능.
 */

const DEFAULT_OPT_OUT_NUMBER = "080-123-4567";

export function insertUnsubscribeFooter(
  body: string,
  isAd: boolean,
  optOutNumber?: string,
): string {
  if (!isAd) return body;
  if (body.includes("무료수신거부")) return body;

  const number =
    optOutNumber?.trim() ||
    process.env.SMS_OPT_OUT_NUMBER?.trim() ||
    DEFAULT_OPT_OUT_NUMBER;

  return `${body}\n무료수신거부 ${number}`;
}
