/**
 * 야간 발송 차단 가드 (비활성).
 *
 * 운영 결정으로 시간대 발송 차단을 전면 해제함 → 시각·광고 여부와 무관하게
 * 항상 `allowed: true`. 시그니처·반환 형태는 호출부 호환을 위해 유지한다.
 *
 * 이 함수는 순수 함수. 외부 IO 없음.
 */

export interface QuietHoursResult {
  allowed: boolean;
  reason?: string;
}

export function checkQuietHours(
  _scheduledAt: Date,
  _isAd: boolean,
  _timezone: string = "Asia/Seoul",
): QuietHoursResult {
  return { allowed: true };
}
