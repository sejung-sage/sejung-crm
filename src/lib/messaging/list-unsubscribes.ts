/**
 * 수신거부 관리 페이지용 목록 로더.
 *
 * crm_unsubscribes(phone TEXT PK, unsubscribed_at TIMESTAMPTZ, reason TEXT) 조회.
 * RLS: 읽기 전체 — 별도 권한 가드 없이 SELECT 위임 (페이지가 master/admin 게이팅).
 *
 * 정책:
 *   - dev-seed 모드: 빈 배열 (개발용 시드에 수신거부 데이터 없음).
 *   - 전체 조회 후 unsubscribed_at DESC 정렬.
 *   - search: phone 숫자 추출 → ilike, 또는 reason ilike 로 좁힘.
 *     PostgREST `.or(...)` 인자 인젝션 방어 — 숫자/공백만 허용 패턴 통과분만 사용.
 *   - student_name: parent_phone 매칭으로 베스트에포트 조인 (쿼리 1회 추가).
 *     11자리 번호만 `010-XXXX-XXXX` 하이픈형 복원해 한 번에 in() 조회.
 *     매칭 안 되거나 RLS 로 안 보이면 null. N+1 금지.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";

export interface UnsubscribeRow {
  /** 저장된 원형 phone (보통 숫자만). */
  phone: string;
  /** 수신거부 시각 ISO. */
  unsubscribed_at: string;
  /** 사유 (없으면 null). */
  reason: string | null;
  /** parent_phone 매칭 학생명 (베스트에포트, RLS 범위 내). 없으면 null. */
  student_name: string | null;
}

/** search 에서 숫자만 추출 (phone ilike 용). */
function extractDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** ILIKE 메타문자 제거 — `.or(...)` 절에 박을 때 인젝션·문법 가드. */
const ILIKE_META_PATTERN = /[,()%_*]/g;

/** 비숫자 제거. 빈 결과는 null. */
function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

/** 11자리 숫자(휴대폰)면 `010-XXXX-XXXX` 하이픈형으로 복원. 아니면 null. */
function toHyphenated11(digits: string): string | null {
  if (digits.length !== 11) return null;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

/** crm_unsubscribes select 응답 좁힌 형태 (Database 타입 추론 한계 대응). */
interface UnsubRecord {
  phone: string;
  unsubscribed_at: string;
  reason: string | null;
}

export async function listUnsubscribes(
  search?: string,
): Promise<UnsubscribeRow[]> {
  if (isDevSeedMode()) {
    return [];
  }

  const supabase = await createSupabaseServerClient();

  // ── 1) crm_unsubscribes 본조회 ─────────────────────────────
  let query = supabase
    .from("crm_unsubscribes")
    .select("phone, unsubscribed_at, reason")
    .order("unsubscribed_at", { ascending: false });

  const trimmed = search?.trim() ?? "";
  if (trimmed.length > 0) {
    const digits = extractDigits(trimmed);
    // reason 검색어는 메타문자 제거. phone 은 숫자만이라 안전.
    const safeReason = trimmed.replace(ILIKE_META_PATTERN, "").trim();
    const clauses: string[] = [];
    if (digits.length > 0) {
      clauses.push(`phone.ilike.%${digits}%`);
    }
    if (safeReason.length > 0) {
      clauses.push(`reason.ilike.%${safeReason}%`);
    }
    if (clauses.length > 0) {
      query = query.or(clauses.join(","));
    }
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`수신거부 목록 조회에 실패했습니다: ${error.message}`);
  }

  const rows = (data ?? []) as UnsubRecord[];
  if (rows.length === 0) return [];

  // ── 2) student_name 베스트에포트 조인 ──────────────────────
  // 11자리 휴대폰만 하이픈형으로 복원해 한 번에 parent_phone in() 조회.
  // 정규화 phone(숫자만) → name 맵을 만들어 매칭.
  const hyphenSet = new Set<string>();
  for (const r of rows) {
    const norm = normalizePhone(r.phone);
    if (!norm) continue;
    const hy = toHyphenated11(norm);
    if (hy) hyphenSet.add(hy);
  }

  const nameByDigits = new Map<string, string>();
  if (hyphenSet.size > 0) {
    const { data: studentData, error: studentError } = await supabase
      .from("crm_students")
      .select("parent_phone, name")
      .in("parent_phone", Array.from(hyphenSet));
    // 조인 실패는 치명적이지 않음 — 이름 없이 목록은 노출. 에러면 맵 비움.
    if (!studentError) {
      const students = (studentData ?? []) as Array<{
        parent_phone: string | null;
        name: string | null;
      }>;
      for (const s of students) {
        const norm = normalizePhone(s.parent_phone);
        if (norm && s.name && !nameByDigits.has(norm)) {
          nameByDigits.set(norm, s.name);
        }
      }
    }
  }

  return rows.map((r) => {
    const norm = normalizePhone(r.phone);
    const student_name = norm ? (nameByDigits.get(norm) ?? null) : null;
    return {
      phone: r.phone,
      unsubscribed_at: r.unsubscribed_at,
      reason: r.reason,
      student_name,
    };
  });
}
