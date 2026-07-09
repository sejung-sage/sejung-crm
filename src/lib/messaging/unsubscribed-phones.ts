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
import type { SupabaseClient } from "@supabase/supabase-js";
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

/**
 * 임의의 Supabase 클라이언트로 수신거부 번호를 읽어 **정규화된 Set** 으로 반환.
 *
 * React cache(요청 스코프)를 쓸 수 없는 곳 — 드레인 워커처럼 service role 클라이언트로
 * 요청 밖에서 도는 코드 — 를 위한 진입점. 반환값은 하이픈 제거된 숫자 문자열.
 * SQL 절에 박지 않고 Set 비교만 하므로 SAFE_PHONE_PATTERN 검사는 불필요하다.
 */
export async function fetchUnsubscribedPhoneSet(
  supabase: SupabaseClient,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("crm_unsubscribes")
    .select("phone");
  if (error) {
    throw new Error(`수신거부 목록 조회에 실패했습니다: ${error.message}`);
  }
  const set = new Set<string>();
  for (const row of data ?? []) {
    const norm = normalizePhone((row as { phone: string }).phone);
    if (norm) set.add(norm);
  }
  return set;
}

/** 하이픈 등 비숫자 제거. 빈 결과는 null. */
function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

/**
 * 단일 번호의 수신거부 여부 조회.
 *
 * - phone 을 숫자만으로 정규화 후, getUnsubscribedPhones() 결과(역시 숫자만으로
 *   정규화)에 포함되는지 비교. 저장이 하이픈 포함이어도 정규화로 안전 비교.
 * - null/빈값/정규화 후 빈값 → false.
 * - getUnsubscribedPhones 의 React cache 를 재사용 (요청 단위 1회 페치).
 */
export async function isPhoneUnsubscribed(
  phone: string | null | undefined,
): Promise<boolean> {
  const norm = normalizePhone(phone);
  if (!norm) return false;
  const phones = await getUnsubscribedPhones();
  for (const p of phones) {
    if (normalizePhone(p) === norm) return true;
  }
  return false;
}
