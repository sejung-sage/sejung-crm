/**
 * 학부모 연락처 관련 유틸.
 * PRD 섹션 6.3 보안: 로그에 번호가 평문으로 남지 않아야 함.
 */

/**
 * 전화번호 표시 포맷. UI 표시용.
 *   01012345678 → 010-1234-5678
 *   0212345678  → 02-1234-5678
 */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("02")) {
    if (digits.length === 9) return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
    if (digits.length === 10) return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  return raw;
}

/**
 * 로그·스냅샷 용 마스킹. 항상 010-****-XXXX 형태.
 * PRD 6.3: "학부모 연락처 로그 마스킹 (010-****-1234)"
 */
export function maskPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  const last4 = digits.slice(-4);
  const prefix = digits.length >= 11 ? digits.slice(0, 3) : "***";
  return `${prefix}-****-${last4}`;
}

/**
 * DB 에 저장할 때 하이픈 제거한 숫자 형태.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits || null;
}
