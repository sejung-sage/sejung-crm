/**
 * KST 일시 변환 헬퍼 — 설명회 폼 입력 → DB timestamptz ISO.
 *
 * 새 설명회 생성 폼(`new-seminar-form.tsx`) 에서 두 종류의 입력값을 받는다:
 *  1) `<input type="date">` + `<input type="time">` 분리 입력 (설명회 진행 일시)
 *  2) `<input type="datetime-local">` 통합 입력 (신청 마감)
 *
 * 두 입력 모두 timezone 정보 없이 로컬 시각만 전달되므로, 운영 정책상 항상 KST
 * (+09:00) 로 간주하고 UTC ISO 로 직렬화한다. 빈 값·잘못된 입력은 모두 null —
 * 호출부가 NULL 컬럼으로 INSERT 한다.
 *
 * 단위 테스트(`tests/unit/seminar-kst-helpers.test.ts`) 가 정확한 변환·경계
 * 케이스를 검증한다. 폼 변경 전에 반드시 테스트부터.
 */

/**
 * `date` (YYYY-MM-DD) + `time` (HH:MM) → KST 로 해석한 UTC ISO timestamp.
 *
 * - 둘 중 하나라도 비어 있거나 공백만이면 `null`.
 * - `new Date()` 가 NaN 을 뱉으면(잘못된 입력) `null`.
 *
 * 반환 ISO 는 항상 UTC 표기 (`...Z`). 예: KST 19:00 → `T10:00:00.000Z`.
 */
export function combineKstDateTime(
  date: string,
  time: string,
): string | null {
  const d = date.trim();
  const t = time.trim();
  if (!d || !t) return null;
  const parsed = new Date(`${d}T${t}:00+09:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/**
 * `datetime-local` 입력값(`YYYY-MM-DDTHH:MM`) → KST 로 해석한 UTC ISO.
 *
 * - 빈 값/공백 → `null`.
 * - 잘못된 입력(예: `"not-a-date"`) → `null`.
 *
 * 브라우저 `datetime-local` 은 timezone 정보를 전달하지 않으므로 입력값이
 * 모두 KST 라는 가정으로 +09:00 보정 후 UTC ISO 로 직렬화한다.
 */
export function datetimeLocalToKstIso(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const parsed = new Date(`${v}:00+09:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}
