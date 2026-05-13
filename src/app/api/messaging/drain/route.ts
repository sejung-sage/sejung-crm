/**
 * 캠페인 드레인 워커 API route.
 *
 * 호출 흐름:
 *   1. Server Action(`runImmediateSend`) 이 messages('대기') INSERT 후 본 라우트를
 *      `waitUntil` 로 fire-and-forget 호출.
 *   2. 본 라우트는 `drainCampaignChunk` 로 1청크(최대 1,000건) 발송.
 *   3. 남은 '대기' 가 있으면 자기 자신을 fire-and-forget 으로 재호출 → 다음 청크 처리.
 *   4. 다 끝나면 campaigns.status 를 '완료'/'실패' 로 마감.
 *
 * 인증:
 *   - 헤더 `x-drain-secret` 으로 검증. env DRAIN_SECRET 필수.
 *   - DRAIN_SECRET 미설정이면 500. 운영 배포 전 반드시 설정.
 *
 * 재호출 base URL:
 *   - Vercel 배포면 https://${VERCEL_URL} (per-deployment URL)
 *   - 로컬은 APP_BASE_URL 또는 http://localhost:3000
 *
 * 타임아웃:
 *   - maxDuration = 300 (Vercel 기본 5분)
 *   - 한 청크 ≈ 20~40초, 안전 마진 충분.
 */

import { waitUntil } from "@vercel/functions";
import { drainCampaignChunk } from "@/lib/messaging/drain-campaign";
import { getMessagingBaseUrl } from "@/lib/messaging/base-url";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface DrainRequestBody {
  campaignId: string;
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.DRAIN_SECRET;
  if (!secret) {
    return Response.json(
      { error: "DRAIN_SECRET 환경변수 미설정 — 운영 적용 전 필수" },
      { status: 500 },
    );
  }

  const headerSecret = request.headers.get("x-drain-secret");
  if (headerSecret !== secret) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: DrainRequestBody;
  try {
    body = (await request.json()) as DrainRequestBody;
  } catch {
    return Response.json(
      { error: "JSON body 파싱 실패" },
      { status: 400 },
    );
  }

  const campaignId = typeof body?.campaignId === "string" ? body.campaignId : "";
  if (!campaignId) {
    return Response.json(
      { error: "campaignId 가 비어 있습니다" },
      { status: 400 },
    );
  }

  try {
    const result = await drainCampaignChunk(campaignId);

    // 관찰성 로깅 (Vercel logs 추적용). 학부모 번호 등 민감정보는 들어 있지 않음.
    console.log(
      `[drain] campaign=${campaignId} attempted=${result.attempted} ` +
        `sent=${result.sent} failed=${result.failed} hasMore=${result.hasMore} ` +
        `done=${result.campaignDone}`,
    );

    // 다음 청크 남았으면 자기 자신 재호출 (fire-and-forget).
    if (result.hasMore) {
      kickNextChunk(campaignId, secret);
    }

    return Response.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "드레인 처리 실패";
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * 자기 자신 호출 (fire-and-forget).
 * Vercel 서버리스 함수에서도 동작 — 응답을 기다리지 않고 즉시 반환되므로
 * 현재 함수의 응답이 끝난 뒤에도 다음 함수 호출이 별도 인스턴스로 시작된다.
 */
function kickNextChunk(campaignId: string, secret: string): void {
  const url = `${getMessagingBaseUrl()}/api/messaging/drain`;
  // 안전망 2중:
  //   - `keepalive: true`  : Vercel 이 함수 인스턴스를 정리하더라도 in-flight 요청
  //     이 끊기지 않고 끝까지 보내지도록 fetch 에 지시 (page-unload 패턴 차용).
  //   - `waitUntil(...)`   : 응답 송출 후에도 fetch 가 resolve 될 때까지 인스턴스
  //     수명을 연장.
  // 둘 중 하나만 있어도 대부분 동작하지만, 자가호출 chain 의 N번째 단계에서
  // 끊기는 회귀(2026-05-11 10K 캠페인이 4K 에서 멈춤)가 관측돼 둘 다 적용.
  waitUntil(
    fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-drain-secret": secret,
      },
      body: JSON.stringify({ campaignId }),
      keepalive: true,
    }).catch(() => {
      // 네트워크 실패는 의도적으로 무시. /campaigns/[id] 의 "이어보내기" 버튼으로
      // 수동 재개 가능 (lib/messaging/resume-stuck-campaign.ts).
    }),
  );
}
