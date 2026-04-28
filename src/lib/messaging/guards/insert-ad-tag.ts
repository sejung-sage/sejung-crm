/**
 * 광고성 메시지 본문 앞에 `(광고)` prefix 를 자동 삽입.
 *
 * 규약:
 *   - `isAd === false` 면 원문 그대로 반환.
 *   - 이미 `(광고)` 또는 `[광고]` 로 시작하면 중복 삽입 금지.
 *   - 선행 공백(\s) 을 허용한 뒤의 prefix 도 존재하는 것으로 간주.
 *   - prefix 와 본문 사이에는 공백 한 칸 삽입.
 *
 * 이 함수는 순수 함수. 외부 IO 없음.
 */

const AD_PREFIX_REGEX = /^\s*[[(]광고[\])]/;

export function insertAdTag(body: string, isAd: boolean): string {
  if (!isAd) return body;
  if (AD_PREFIX_REGEX.test(body)) return body;
  return `(광고) ${body}`;
}
