/**
 * Vercel Cron entrypoint — 예약 발송 디스패치.
 *
 * vercel.json 의 crons 항목으로 5분마다 호출됨 ('asia/tokyo' 리전 기준 UTC).
 * Authorization 헤더 검증 후 dispatchScheduledCampaigns 실행.
 *
 * 보안:
 *   - Vercel 은 cron 호출 시 자동으로 `Authorization: Bearer ${CRON_SECRET}`
 *     헤더를 박아준다 (env 에 CRON_SECRET 설정 시).
 *   - CRON_SECRET 미설정이면 401 반환 — 운영 배포 전 반드시 설정해야 한다.
 *
 * 동작:
 *   - GET 만 허용. POST/PUT 등은 405.
 *   - 정상 처리 시 200 + DispatchResult JSON 반환 (운영 로그 추적용).
 *   - 처리 중 throw 발생 시 500 + { error } 반환.
 *
 * 타임아웃:
 *   - maxDuration = 300 (Vercel Pro 기본 5분).
 *   - 한 호출에서 캠페인 최대 20개 처리 — 평균 캠페인이 5초 이내 끝난다고 가정.
 */

import { dispatchScheduledCampaigns } from "@/lib/messaging/dispatch-scheduled";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json(
      { error: "CRON_SECRET 환경변수 미설정 — 운영 적용 전 필수" },
      { status: 500 },
    );
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await dispatchScheduledCampaigns();
    return Response.json(result);
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "예약 발송 디스패치 실패";
    return Response.json({ error: message }, { status: 500 });
  }
}
