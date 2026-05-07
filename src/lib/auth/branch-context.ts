/**
 * 분원 컨텍스트 cookie 헬퍼.
 *
 * 로그인 시 사용자가 선택한 분원을 cookie 에 저장. 모든 페이지의 default
 * branch 필터로 사용. URL `?branch=...` 가 명시되면 그게 우선.
 *
 * 보안 모델:
 *  - cookie 는 UX 컨텍스트일 뿐. 실 보안은 RLS 가 분원 격리 담당.
 *  - master 는 RLS 통과로 임의 분원 접근 가능 — cookie 가 어떤 값이든 OK.
 *  - 일반 사용자가 cookie 변조해도 RLS 가 자기 branch 외 차단.
 *
 * 값 표현:
 *  - "전체" sentinel = cookie 미set 또는 명시적으로 "전체" 박힘 (master 전용).
 *    `getSelectedBranch()` 는 sentinel 을 null 로 변환 — 호출부 분기 단순화.
 *  - 그 외 cookie 값은 분원명 그대로 ("대치"/"송도"/"반포"/"방배" 또는 운영
 *    추가 분원).
 *
 * cookie 속성:
 *  - HttpOnly  — XSS 차단
 *  - SameSite=Lax — CSRF 완화 (이 cookie 는 비-mutating UI 컨텍스트라 충분)
 *  - Secure — production 만
 *  - Path=/ — 전 도메인
 *  - Max-Age=30일 — 적당히 길게. 다음 로그인 시 갱신.
 */

import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth/current-user";

const COOKIE_NAME = "selected_branch";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30일
const ALL_SENTINEL = "전체";

/**
 * 현재 선택된 분원을 cookie 에서 읽는다.
 * - cookie 미set / "전체" sentinel → null (= 분원 필터 미적용)
 * - 그 외 → 분원명 그대로
 */
export async function getSelectedBranch(): Promise<string | null> {
  const store = await cookies();
  const v = store.get(COOKIE_NAME)?.value;
  if (!v || v === ALL_SENTINEL) return null;
  return v;
}

/**
 * 선택된 분원을 cookie 에 저장.
 * - branch === null → "전체" sentinel 로 set (= 모든 분원, master 전용)
 * - branch === "" → cookie 삭제
 * - 그 외 → 그대로 set
 *
 * Server Action / route handler 안에서만 호출 가능 (next/headers `cookies()`).
 */
export async function setSelectedBranch(branch: string | null): Promise<void> {
  const store = await cookies();
  if (branch === "") {
    store.delete(COOKIE_NAME);
    return;
  }
  const value = branch === null ? ALL_SENTINEL : branch;
  store.set({
    name: COOKIE_NAME,
    value,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

/**
 * 페이지 default branch 결정 헬퍼.
 *
 * 호출부 패턴:
 *   const params = await searchParams;
 *   const branch = await resolveBranchFilter(params.branch);
 *
 * 동작:
 *   - URL `?branch=<v>` 가 명시되면 그 값 그대로 (cookie 무시)
 *   - URL 미명시 + cookie 있음 → cookie 값
 *   - 둘 다 없음 → undefined (필터 미적용 = 전체)
 */
export async function resolveBranchFilter(
  urlBranch: string | string[] | undefined,
): Promise<string | undefined> {
  // URL 명시 우선 — 첫 값만 사용 (다중 키 X — branch 는 단일).
  const fromUrl = Array.isArray(urlBranch) ? urlBranch[0] : urlBranch;
  if (typeof fromUrl === "string" && fromUrl.trim().length > 0) {
    if (fromUrl === ALL_SENTINEL) return undefined;
    return fromUrl;
  }
  const fromCookie = await getSelectedBranch();
  return fromCookie ?? undefined;
}

/**
 * Server Component 의 searchParams 객체에 branch context 적용.
 *
 * 호출부 패턴:
 *   const params = await applyBranchContextToParams(await searchParams);
 *   // 이후 parseStudentsSearchParams(params) 등 그대로 호출
 *
 * 분원 격리 정책:
 *   - master         : URL 우선 → cookie → undefined(전체).
 *   - 그 외(admin/manager/viewer): URL/cookie 무시, 본인 분원으로 강제.
 *     → URL `?branch=대치` 조작해도 자기 branch 로 덮어쓴다.
 *     → 사이드바에 분원이 정적 표시되는 것과 같은 의미. UI 의 분원 select 자체도
 *       master 만 노출되어야 정합성이 맞다 (toolbar 들에서 별도 가드).
 *   - 비로그인       : 미들웨어가 막으므로 도달하지 않음. 방어로 URL/cookie 흐름 유지.
 *
 * RLS 가 어차피 분원 외 데이터를 차단하지만, URL 변조 시 빈 결과만 비치고
 * "전체 분원" 옵션이 활성으로 보이는 등 UX 가 깨지므로 서버에서도 강제한다.
 */
export async function applyBranchContextToParams<
  T extends Record<string, string | string[] | undefined>,
>(params: T): Promise<T> {
  const user = await getCurrentUser();

  // 일반 사용자: 본인 분원으로 강제 (URL/cookie 모두 무시).
  if (user && user.role !== "master") {
    return { ...params, branch: user.branch };
  }

  // master / 비로그인: URL 우선 → cookie → undefined.
  const existing = params.branch;
  const hasExplicit =
    typeof existing === "string" && existing.trim().length > 0;
  if (hasExplicit) return params;

  const fromCookie = await getSelectedBranch();
  if (!fromCookie) return params;
  return { ...params, branch: fromCookie };
}
