/**
 * Self-invocation 워커가 사용할 base URL.
 *
 * 우선순위:
 *   1. APP_BASE_URL — 명시적 override (커스텀 도메인 등)
 *   2. VERCEL_PROJECT_PRODUCTION_URL — Vercel 이 production deploy 에 자동 노출.
 *      Vercel Deployment Protection 을 우회하는 안정 URL (= production alias).
 *   3. VERCEL_URL — deployment-specific URL. Deployment Protection 이 켜져 있으면
 *      외부 호출이 401 로 막힘. 마지막 fallback.
 *   4. http://localhost:3000 — 로컬 dev.
 */
export function getMessagingBaseUrl(): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return "http://localhost:3000";
}
