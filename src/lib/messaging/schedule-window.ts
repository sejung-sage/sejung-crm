/**
 * 예약 발송 최소 리드타임.
 *
 * sendon 네이티브 예약은 최소 30분(공식 SDK 제약)이지만, 5~30분 구간은 자체 지연발송
 * (cron 이 시각 도래 시 drain 킥)으로 처리하므로 사용자는 5분 뒤부터 예약할 수 있다.
 * cron 주기(vercel.json: 매 1분)에 따라 실제 발송은 예약 시각 + 최대 ~1분이다.
 *
 * 서버(scheduleAction/reschedule)와 클라이언트(작성 화면 datetime 최소값)가 공유.
 */
export const SCHEDULE_MIN_LEAD_MS = 5 * 60_000;

/** 안내 문구용 라벨. */
export const SCHEDULE_MIN_LEAD_LABEL = "5분";

/**
 * sendon 네이티브 예약 최소 시각 = 현재+30분(공식 SDK 제약). 이 미만 예약은 sendon 이
 * 거부하므로 "자체 지연발송"(cron 이 시각 도래 시 drain 킥)으로 처리한다. 이상이면
 * sendon 네이티브 예약(drain 이 reservation.datetime 으로 접수)을 쓴다.
 */
export const SENDON_MIN_RESERVATION_MS = 30 * 60_000;
