import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";

/**
 * Next.js 16 Server Component·Server Action 용 Supabase 클라이언트.
 *
 * Next 16 에서 `cookies()` 가 Promise 를 반환하도록 변경됨 →
 * 이 함수는 반드시 `await createSupabaseServerClient()` 로 호출.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // Server Component 에서 호출 시 set 이 막히지만, 무시해도 안전.
          // middleware/proxy 에서 세션 갱신이 일어나므로 문제 없음.
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            /* no-op */
          }
        },
      },
    },
  );
}

/**
 * Service Role 키를 사용하는 서버 전용 클라이언트.
 * RLS 를 우회해야 하는 발송 큐 처리·Webhook 핸들러 등에서만 사용.
 * 절대 Client Component 에 전달하지 말 것.
 */
export function createSupabaseServiceClient() {
  return createServerClient<Database>(
    getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {
          /* service role은 세션 쿠키 사용 안 함 */
        },
      },
    },
  );
}

function getRequiredEnv(key: string): string {
  const v = process.env[key];
  if (!v) {
    throw new Error(
      `환경변수 ${key} 가 설정되어 있지 않습니다. .env.local 을 확인하세요.`,
    );
  }
  return v;
}
