/**
 * Vercel Cron entrypoint — sendon 비동기 발송 실패 점검 + Slack 알림.
 *
 * vercel.json 의 crons 항목으로 30분마다 호출됨. 최근 캠페인의 sendon 측 실제
 * 결과를 대조해 '발송됨' 인데 sendon 에서 실패(포인트 부족 등)한 건이 있으면
 * Slack 으로 캠페인당 1회 알린다. Slack 미설정(SLACK_BOT_TOKEN/CHANNEL_ID)이면 skip.
 *
 * 보안: dispatch-scheduled-campaigns 와 동일 — Vercel 이 박는
 *   `Authorization: Bearer ${CRON_SECRET}` 검증. CRON_SECRET 미설정이면 500.
 *
 * 동작: GET 만. 정상 시 200 + ReconcileResult. throw 시 500.
 * maxDuration = 300 (Vercel Pro 기본 5분).
 */

import { reconcileSendonFailures } from "@/lib/messaging/reconcile-sendon-failures";

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
    const result = await reconcileSendonFailures();
    return Response.json(result);
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "sendon 실패 점검 실패";
    return Response.json({ error: message }, { status: 500 });
  }
}
