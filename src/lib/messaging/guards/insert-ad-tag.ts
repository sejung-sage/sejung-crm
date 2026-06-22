/**
 * 발신 브랜드 머리말 + 광고 `(광고)` 표기 자동 삽입.
 *
 * 본문 규약(insertSenderHeader):
 *   - **광고/비광고 무관, 항상 본문 맨 위에 발신 브랜드명을 한 줄 붙인다**
 *     (운영자 요청 2026-06-17 — 수신자가 어느 분원에서 온 문자인지 알 수 있게).
 *   - 광고면 그 위에 `(광고)` 줄을 한 번 더 얹는다.
 *   - 브랜드명은 **분원별**(branchBrandName): 대치="세정학원", 그 외="{분원} 세정학원".
 *   - 형식: 비광고 `{브랜드}\n\n{본문}` · 광고 `(광고)\n{브랜드}\n\n{본문}`.
 *     (브랜드 머리와 본문 사이에 빈 줄 1개 — 수신자가 머리말과 본문을 또렷이 구분.)
 *   - 이미 `(광고)`/`[광고]` 로 시작하면 머리가 박힌 것으로 보고 그대로(중복 방지).
 *   - 본문 첫 줄이 이미 그 브랜드명이면 중복으로 보고 다시 붙이지 않는다.
 *
 * 제목 규약(insertAdSubjectTag): LMS 제목 앞 `(광고) ` (브랜드는 제목엔 안 붙임).
 *
 * 모두 순수 함수. 외부 IO 없음. 서버 가드가 최종 검증선, 클라이언트 미리보기도
 * 동일 함수로 바이트·미리보기를 계산한다.
 */

/** 기본(대치/단일) 발신 브랜드명. */
export const BRAND_BASE = "세정학원";

/**
 * @deprecated 분원별 브랜드는 branchBrandName 사용. 미리보기 헤더 기본값 등에만 잔존.
 */
export const AD_SENDER_NAME = BRAND_BASE;

/** 분원별 발신 브랜드명. 대치는 접두 없음, 그 외는 "{분원} 세정학원". */
const BRANCH_BRAND: Record<string, string> = {
  대치: BRAND_BASE,
  반포: `반포 ${BRAND_BASE}`,
  송도: `송도 ${BRAND_BASE}`,
  방배: `방배 ${BRAND_BASE}`,
};

/** 분원 → 발신 브랜드명. 미지정/마스터/알 수 없는 값은 기본(세정학원). */
export function branchBrandName(branch?: string | null): string {
  if (!branch) return BRAND_BASE;
  return BRANCH_BRAND[branch] ?? BRAND_BASE;
}

const AD_PREFIX_REGEX = /^\s*[[(]광고[\])]/;

/**
 * 본문 맨 위에 발신 브랜드명(+광고면 (광고))을 삽입.
 * brand 는 호출부가 branchBrandName(branch) 로 해석해 넘긴다(필수 — 누락 방지).
 */
export function insertSenderHeader(
  body: string,
  isAd: boolean,
  brand: string,
): string {
  // 이미 (광고)/[광고] 로 시작하면 머리가 박힌 것으로 보고 그대로(중복 방지).
  if (AD_PREFIX_REGEX.test(body)) return body;
  // 첫 줄이 이미 그 브랜드명이면 중복으로 보고 다시 안 붙임.
  const firstLine = body.split("\n", 1)[0]?.trim();
  const withBrand = firstLine === brand ? body : `${brand}\n\n${body}`;
  return isAd ? `(광고)\n${withBrand}` : withBrand;
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
