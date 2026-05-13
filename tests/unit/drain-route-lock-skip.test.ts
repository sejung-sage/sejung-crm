/**
 * /api/messaging/drain — lockSkipped 분기 회귀 테스트.
 *
 * 0031 sweep + 0032 advisory lock 조합에서 동시성 윈도우 보호:
 *   - drainCampaignChunk 가 lockSkipped=true 로 반환하면
 *     route 는 self-invocation(kickNextChunk) 을 띄우지 않아야 한다.
 *     (다른 인스턴스가 점유 중 — 자기가 또 띄우면 무한 핑퐁 + 이중 발송 윈도우 확장)
 *   - lockSkipped=false 이고 hasMore=true 면 정확히 1회 fetch self-invocation.
 *
 * 그 외 401 분기 등은 다루지 않음 (이번 변경 범위 밖).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Mock } from "vitest";

// ─── 모듈 모킹 ──────────────────────────────────────────────

vi.mock("@/lib/messaging/drain-campaign", () => ({
  drainCampaignChunk: vi.fn(),
  DRAIN_CHUNK_SIZE: 1000,
}));

// waitUntil 은 단순 즉시 실행으로 — 호출 자체와 인자(fetch promise) 만 검증하면 된다.
// vi.mock 은 호이스트되므로 spy 도 vi.hoisted 로 같이 끌어올려야 함.
const { waitUntilSpy } = vi.hoisted(() => ({
  waitUntilSpy: vi.fn((p: Promise<unknown>) => {
    // 운영에서는 Vercel 런타임이 함수 종료 전까지 promise 를 살려둠.
    // 테스트에서는 호출 여부만 보면 충분.
    return p;
  }),
}));
vi.mock("@vercel/functions", () => ({
  waitUntil: waitUntilSpy,
}));

import { POST } from "@/app/api/messaging/drain/route";
import { drainCampaignChunk } from "@/lib/messaging/drain-campaign";

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";
const SECRET = "drain-secret-fixture";

function buildRequest(): Request {
  return new Request("http://localhost:3000/api/messaging/drain", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-drain-secret": SECRET,
    },
    body: JSON.stringify({ campaignId: CAMPAIGN_ID }),
  });
}

let originalFetch: typeof globalThis.fetch | undefined;
let fetchSpy: Mock;

beforeEach(() => {
  process.env.DRAIN_SECRET = SECRET;
  delete process.env.APP_BASE_URL;
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  delete process.env.VERCEL_URL;

  originalFetch = globalThis.fetch;
  fetchSpy = vi.fn(async () => new Response("ok", { status: 200 }));
  globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

  waitUntilSpy.mockClear();
  (drainCampaignChunk as unknown as Mock).mockReset();
});

afterEach(() => {
  if (originalFetch) globalThis.fetch = originalFetch;
});

describe("POST /api/messaging/drain · lockSkipped=true 면 self-invocation 안 띄움", () => {
  it("lockSkipped=true + hasMore=true → kickNextChunk 미호출", async () => {
    (drainCampaignChunk as unknown as Mock).mockResolvedValue({
      campaignId: CAMPAIGN_ID,
      attempted: 0,
      sent: 0,
      failed: 0,
      hasMore: true,
      addedCost: 0,
      campaignDone: false,
      lockSkipped: true,
    });

    const res = await POST(buildRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lockSkipped: boolean };
    expect(body.lockSkipped).toBe(true);

    // self-invocation 경로(waitUntil + fetch) 둘 다 호출되면 안 됨
    expect(waitUntilSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("POST /api/messaging/drain · lockSkipped=false + hasMore=true → 정확히 1회 self-invocation", () => {
  it("kickNextChunk 가 fetch 를 1회 발사 + waitUntil 로 감쌈", async () => {
    (drainCampaignChunk as unknown as Mock).mockResolvedValue({
      campaignId: CAMPAIGN_ID,
      attempted: 1000,
      sent: 990,
      failed: 10,
      hasMore: true,
      addedCost: 7400,
      campaignDone: false,
      lockSkipped: false,
    });

    const res = await POST(buildRequest());
    expect(res.status).toBe(200);

    expect(waitUntilSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // fetch 인자: URL + method + 헤더 + body
    const fetchArgs = fetchSpy.mock.calls[0];
    const url = fetchArgs?.[0] as string;
    const init = fetchArgs?.[1] as RequestInit;
    expect(url).toBe("http://localhost:3000/api/messaging/drain");
    expect(init.method).toBe("POST");
    expect(
      (init.headers as Record<string, string>)["x-drain-secret"],
    ).toBe(SECRET);
    const sentBody = JSON.parse(init.body as string) as {
      campaignId: string;
    };
    expect(sentBody.campaignId).toBe(CAMPAIGN_ID);
  });
});

describe("POST /api/messaging/drain · hasMore=false → self-invocation 미호출", () => {
  it("정상 마감 시 fetch/waitUntil 둘 다 호출 안 됨", async () => {
    (drainCampaignChunk as unknown as Mock).mockResolvedValue({
      campaignId: CAMPAIGN_ID,
      attempted: 500,
      sent: 500,
      failed: 0,
      hasMore: false,
      addedCost: 3700,
      campaignDone: true,
      lockSkipped: false,
    });

    const res = await POST(buildRequest());
    expect(res.status).toBe(200);
    expect(waitUntilSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
