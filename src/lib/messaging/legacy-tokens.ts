/**
 * Aca2000 치환 문법(`%%학생`) 감지 · 변환.
 *
 * 배경 (2026-08-07 반포 부원장 상용문구 제보):
 *   행정팀이 Aca2000 에서 쓰던 문구를 그대로 복사해 붙여넣는다. Aca2000 은
 *   `%%학생` 을 학생 이름으로 치환하지만 우리 시스템의 토큰은 `{이름}` 이라,
 *   그대로 저장하면 치환 없이 `%%학생` 글자가 그대로 발송된다.
 *   → 입력 시점에 감지해서 경고하고, 한 번에 고칠 수 있게 한다.
 *
 * 순수 함수만 export. DB·React 의존 없음.
 */

/** Aca2000 → 우리 토큰 변환표. 확실히 대응되는 것만 담는다. */
const LEGACY_TOKEN_MAP: Record<string, string> = {
  "%%학생": "{이름}",
};

/**
 * 본문에 등장하는 `%%...` 형태 토큰을 중복 없이, 등장 순서대로 수집.
 *
 * `%%` 뒤의 한글·영문·숫자·밑줄 연속을 하나의 토큰으로 본다. 변환표에 없는
 * 토큰(`%%반이름` 등)도 잡아야 "치환되지 않는다" 고 경고할 수 있으므로
 * 변환 가능 여부와 무관하게 전부 수집한다.
 */
export function findLegacyTokens(body: string): string[] {
  const matches = body.match(/%%[가-힣A-Za-z0-9_]+/g);
  if (!matches) return [];
  return [...new Set(matches)];
}

/**
 * 변환표에 있는 Aca2000 토큰을 우리 토큰으로 치환.
 * 변환표에 없는 `%%...` 는 그대로 둔다 — 무엇으로 바꿔야 할지 알 수 없고,
 * 임의로 지우면 문구가 조용히 망가진다.
 */
export function convertLegacyTokens(body: string): string {
  let next = body;
  for (const [legacy, modern] of Object.entries(LEGACY_TOKEN_MAP)) {
    next = next.split(legacy).join(modern);
  }
  return next;
}

/** 자동 변환으로 고칠 수 있는 토큰이 본문에 있는지. */
export function hasConvertibleLegacyToken(body: string): boolean {
  return Object.keys(LEGACY_TOKEN_MAP).some((legacy) => body.includes(legacy));
}
