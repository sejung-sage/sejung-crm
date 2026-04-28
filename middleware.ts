/**
 * F4 · Next.js 미들웨어 · Supabase 세션 + 권한 게이트
 *
 * 보호 범위:
 *   - `/`, `/students/*`, `/groups/*`, `/templates/*`, `/campaigns/*`,
 *     `/accounts/*`, `/me`, `/admin/*`
 *
 * 제외:
 *   - `/login`, `/auth/*` (비밀번호 재설정 콜백 등), 정적 자산 전반
 *
 * 동작:
 *   1) dev-seed 모드: 세션 검사 스킵. 자동 로그인 시뮬레이션으로 간주하고 통과.
 *   2) 세션 없음 → `/login?next=<원래경로>` 로 리다이렉트.
 *   3) 세션 있음 + users_profile.active=false → 강제 로그아웃 + `/login?deactivated=1`.
 *   4) 세션 있음 + must_change_password=true + 현재 경로 != `/me` → `/me?forced=1`.
 *
 * Supabase SSR 공식 가이드의 쿠키 getAll/setAll 패턴을 따름.
 * (getSession 이 아닌 getUser 를 써서 JWT 서명 재검증까지 강제)
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

// isDevSeedMode() 을 edge 런타임에서 쓰기 위해 동일한 판정 로직을 인라인.
// (students-dev-seed.ts 전체를 edge 로 끌고 가지 않기 위함.)
function isDevSeedModeEdge(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return (
    !url ||
    url.includes("your-project") ||
    process.env.SEJUNG_DEV_SEED === "1"
  );
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // dev-seed 모드면 통과 (자동 로그인 시뮬레이션)
  if (isDevSeedModeEdge()) {
    return NextResponse.next();
  }

  // 쿠키 write 를 위한 response 객체
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnon) {
    // 환경변수 누락 — 미들웨어가 앱 전체를 막지 않도록 통과시키되
    // 운영에서는 서버 시작 단계에서 걸려야 함.
    return response;
  }

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 로그인 필요
  if (!user) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.search = "";
    redirect.searchParams.set("next", pathname + search);
    return NextResponse.redirect(redirect);
  }

  // 프로필 조회 (active, must_change_password)
  const { data: profile } = await supabase
    .from("users_profile")
    .select("active, must_change_password")
    .eq("user_id", user.id)
    .maybeSingle();

  // 프로필 없음(초대 직후 race) → 강제 로그아웃
  if (!profile) {
    await supabase.auth.signOut();
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.search = "";
    return NextResponse.redirect(redirect);
  }

  const p = profile as { active: boolean; must_change_password: boolean };

  if (!p.active) {
    await supabase.auth.signOut();
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.search = "";
    redirect.searchParams.set("deactivated", "1");
    return NextResponse.redirect(redirect);
  }

  // 첫 로그인 비밀번호 변경 강제 — /me 외 접근 차단
  if (p.must_change_password && pathname !== "/me") {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/me";
    redirect.search = "";
    redirect.searchParams.set("forced", "1");
    return NextResponse.redirect(redirect);
  }

  return response;
}

/**
 * matcher:
 *   - 모든 경로를 기본 포함하되
 *   - /login, /auth/*, /api/*(웹훅/콜백), 정적 자산(_next, favicon, public) 은 제외.
 *
 * 주의: 여기에 포함된 경로만 서버 사이드 세션 검사가 이뤄진다.
 */
export const config = {
  matcher: [
    /*
     * 제외:
     *   - api/*         (서버 핸들러에서 별도 인증)
     *   - _next/static  (정적 번들)
     *   - _next/image   (이미지 최적화)
     *   - favicon.ico   (정적)
     *   - login, auth/* (비인증 경로)
     *   - 확장자 있는 자산(.png, .svg, .ico 등)
     */
    "/((?!api|_next/static|_next/image|favicon.ico|login|auth|.*\\..*).*)",
  ],
};
