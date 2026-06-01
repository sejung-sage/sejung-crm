/**
 * 설명회 공개 링크 토큰 생성기.
 *
 * 사용처: 설명회 생성 Server Action 이 `crm_seminars.link_token` 컬럼에
 *  INSERT 할 값 — 추측 방지 + URL-safe.
 *
 * 길이/엔트로피:
 *  - 12자 nanoid (default 알파벳 `A-Za-z0-9_-` 64종)
 *  - log2(64^12) ≈ 72 비트 — 무차별 추측 충분히 차단.
 *  - URL 슬러그 길이로도 부담 없음(/s/abc123def456 정도).
 *
 * 충돌 확률:
 *  - UNIQUE 제약(0080)이 최후 가드. 충돌 시 INSERT 실패 → 호출부가 재시도.
 *  - 1억 건이어도 충돌 확률 ~1e-6 수준 — 운영 규모에선 사실상 0.
 *
 * 서버 전용:
 *  - DB INSERT 시점에만 호출. 클라이언트 측에서 미리 생성·검증 X.
 *  - nanoid 패키지는 ESM 전용이라 Server Component / Server Action 에서만 사용.
 */

import { nanoid } from "nanoid";

/** 토큰 길이 — 0080 마이그 link_token 컬럼 정책과 동기화. */
export const SEMINAR_LINK_TOKEN_LENGTH = 12;

/**
 * 새 link_token 1개 생성.
 *
 * 반환값은 항상 URL-safe (`A-Za-z0-9_-`). 호출부는 그대로 INSERT.
 * INSERT 가 UNIQUE 위반으로 실패하면 재호출하여 새 토큰으로 재시도.
 */
export function generateLinkToken(): string {
  return nanoid(SEMINAR_LINK_TOKEN_LENGTH);
}
