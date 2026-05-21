/**
 * 화면 표시용 KST(Asia/Seoul) 시간 포맷터.
 *
 * Supabase 의 timestamptz 컬럼(sent_at / scheduled_at / created_at 등) 은
 * UTC ISO 문자열로 직렬화되어 클라이언트로 내려온다.
 *
 * 옛 코드들은 ISO 문자열을 `match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)`
 * 로 substring 만 뽑아 표시했는데, 이는 UTC 시각을 그대로 보여주는 버그였다.
 * 사용자가 KST 19:00 에 발송했는데 화면엔 "10:00" 으로 떠 "시간이 이상하다"
 * 호소.
 *
 * 본 모듈은 Intl.DateTimeFormat 으로 Asia/Seoul 변환을 보장한다.
 */

const KST_DATE_TIME_FMT = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const KST_DATE_FMT = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * ISO timestamp → "YYYY-MM-DD HH:MM" (KST).
 *
 * - 입력이 null / undefined / 빈 문자열이면 placeholder ("—") 반환.
 * - Date.parse 실패 시 원본 문자열 그대로 반환 (디버그 보조).
 */
export function formatKstDateTime(
  iso: string | null | undefined,
  placeholder = "—",
): string {
  if (!iso) return placeholder;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Intl.DateTimeFormat 이 ko-KR + 2자리 month/day 조합에서 종종
  // "2026. 05. 20." 형태를 반환 — formatToParts 로 분해해 일관된
  // 하이픈 표기로 통일한다.
  return toHyphenatedDateTime(d);
}

/**
 * ISO timestamp → "YYYY-MM-DD" (KST). 시간 미표시.
 */
export function formatKstDate(
  iso: string | null | undefined,
  placeholder = "—",
): string {
  if (!iso) return placeholder;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = KST_DATE_FMT.formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function toHyphenatedDateTime(d: Date): string {
  const parts = KST_DATE_TIME_FMT.formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}
