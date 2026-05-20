/**
 * 수신거부 학부모 번호 목록 — 페치 dedupe 단일 소스.
 *
 * 같은 요청 내에서 count-recipients · preview-recipients · drain-campaign 등이
 * 각자 crm_unsubscribes 를 페치하면 동일 요청에 중복 라운드트립이 발생한다.
 * React `cache()` 로 묶어 한 요청 내 한 번만 페치하고, 이후 호출은 메모이즈된
 * 배열을 그대로 받는다.
 *
 * dedupe 대상은 **요청 단위** — 요청 간에는 (운영자가 수신거부 추가/삭제했을 수도
 * 있으니) 캐시 공유하지 않는다. 따라서 unstable_cache 가 아닌 React cache.
 *
 * 보안 정책:
 *   - PostgREST `.or(...)` 같은 SQL 절 인자에 박을 때 메타문자 인젝션을 막기 위해
 *     숫자/하이픈만 허용하는 정규식 통과 결과만 반환.
 */

import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** 수신거부 phone 값에 허용할 문자 패턴 (숫자/하이픈만). */
const SAFE_PHONE_PATTERN = /^[\d-]+$/;

export const getUnsubscribedPhones = cache(async (): Promise<string[]> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("crm_unsubscribes")
    .select("phone");
  if (error) {
    throw new Error(`수신거부 목록 조회에 실패했습니다: ${error.message}`);
  }
  return (data ?? [])
    .map((r) => (r as { phone: string }).phone)
    .filter(
      (v): v is string =>
        typeof v === "string" && v.length > 0 && SAFE_PHONE_PATTERN.test(v),
    );
});
