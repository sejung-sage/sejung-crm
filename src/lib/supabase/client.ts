import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

/**
 * Client Component 용 Supabase 브라우저 클라이언트.
 * 서버 Component·Server Action 에서는 `@/lib/supabase/server` 를 사용할 것.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    // 신·구 키 형식 모두 지원: publishable(sb_publishable_*) 우선, 구 anon(eyJ...) fallback.
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      "",
  );
}
