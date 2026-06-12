/**
 * 광고성 메시지에 `(광고)` 표기를 자동 삽입.
 *
 * 본문 규약(insertAdTag):
 *   - `isAd === false` 면 원문 그대로 반환.
 *   - 이미 `(광고)` 또는 `[광고]` 로 시작하면 중복 삽입 금지.
 *   - 형식: 첫 줄 `(광고)`, 둘째 줄 발신 브랜드명(세정학원), 그 아래 본문.
 *
 * 제목 규약(insertAdSubjectTag):
 *   - LMS 제목 앞에 `(광고) ` 를 붙인다. SMS(제목 없음)·빈 제목은 그대로.
 *
 * 두 함수 모두 순수 함수. 외부 IO 없음.
 */

/** 광고 머리에 붙는 발신 브랜드명(세정학원 단일 테넌트). */
export const AD_SENDER_NAME = "세정학원";

const AD_PREFIX_REGEX = /^\s*[[(]광고[\])]/;

export function insertAdTag(body: string, isAd: boolean): string {
  if (!isAd) return body;
  if (AD_PREFIX_REGEX.test(body)) return body;
  return `(광고)\n${AD_SENDER_NAME}\n${body}`;
}

/**
 * 광고 메시지의 제목 앞에 `(광고) ` 를 붙인다 (LMS 제목용).
 * SMS 처럼 제목이 없거나(null/빈문자) 이미 (광고) 로 시작하면 그대로 반환.
 */
export function insertAdSubjectTag(
  subject: string | null,
  isAd: boolean,
): string | null {
  if (!isAd) return subject;
  if (!subject || subject.trim().length === 0) return subject;
  if (AD_PREFIX_REGEX.test(subject)) return subject;
  return `(광고) ${subject}`;
}
