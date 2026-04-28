/**
 * 광고성 문자 야간 발송 차단 가드.
 *
 * 규약(정통부 고시):
 *   - 21:00 ~ 08:00 (KST, 익일 08:00 까지) 사이 광고성 문자 발송 금지.
 *   - 경계:
 *       · 08:00 정각 = 허용 (경계 열림)
 *       · 21:00 정각 = 차단 (경계 닫힘)
 *     즉 금지 시간: `hour >= 21 || hour < 8`.
 *   - 정보성(isAd=false) 은 24시간 가능 → 항상 `allowed: true`.
 *
 * 시각 추출:
 *   - 기본 타임존 'Asia/Seoul'. Node 22+ / 브라우저 모두 `Intl.DateTimeFormat` 지원.
 *   - 인자 `timezone` 으로 주입 가능. 테스트에서는 다른 TZ 로 검증.
 *
 * 이 함수는 순수 함수. 외부 IO 없음.
 */

export interface QuietHoursResult {
  allowed: boolean;
  reason?: string;
}

export function checkQuietHours(
  scheduledAt: Date,
  isAd: boolean,
  timezone: string = "Asia/Seoul",
): QuietHoursResult {
  if (!isAd) {
    return { allowed: true };
  }

  const hour = getHourInTimezone(scheduledAt, timezone);
  const blocked = hour >= 21 || hour < 8;

  if (blocked) {
    return {
      allowed: false,
      reason: "야간 광고 차단 (21~08)",
    };
  }
  return { allowed: true };
}

/**
 * 주어진 Date 를 지정 TZ 기준 "시" 로 환산 (0~23).
 */
function getHourInTimezone(date: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const hourPart = parts.find((p) => p.type === "hour");
  if (!hourPart) {
    // 극히 드문 경우 폴백: UTC 시간 사용
    return date.getUTCHours();
  }
  // en-US + hour12:false 일 때 24:xx 으로 표기되는 경우가 있어 mod 24 처리
  const parsed = Number.parseInt(hourPart.value, 10);
  if (!Number.isFinite(parsed)) return date.getUTCHours();
  return parsed % 24;
}
