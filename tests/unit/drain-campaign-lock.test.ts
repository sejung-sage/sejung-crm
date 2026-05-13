/**
 * 드레인 advisory lock 회귀 테스트.
 *
 * 0031 (pg_cron sweep) + 0032 (try_lock_campaign / unlock_campaign) 도입 후
 * 동시성 윈도우에서 같은 메시지가 두 번 sendon 으로 가지 않도록 보장한다.
 *
 * 시나리오:
 *   1) try_lock_campaign=false → drain 즉시 종료 (어댑터/DB 미호출, unlock 도 미호출)
 *   2) try_lock_campaign=true  → 정상 진행 후 finally 에서 unlock 1회
 *   3) lock 획득 후 throw → 예외 propagate 되더라도 unlock 호출됨 (try/finally 가드)
 *
 * 회귀 보호: "이중 발송보다 sweep 한 cycle 더 기다리는 게 낫다" 정책.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Mock } from "vitest";

// ─── 모듈 모킹 (vi.mock 은 호이스트됨) ──────────────────────────

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: vi.fn(),
  // createSupabaseServerClient 는 drain 경로에서 안 쓰지만 임포트 안전 위해 둠
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/messaging/adapters", () => ({
  createSmsAdapter: vi.fn(),
}));

import { drainCampaignChunk } from "@/lib/messaging/drain-campaign";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { createSmsAdapter } from "@/lib/messaging/adapters";

// ─── 헬퍼: 체이닝 가능한 supabase fake ─────────────────────────

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

interface FromCall {
  table: string;
  op: "select" | "update";
  args: unknown[];
}

interface FakeSupabaseOptions {
  /** try_lock_campaign 의 응답 (data) */
  lockResult: boolean | null;
  /** loadCampaign 응답 (없으면 기본 캠페인) */
  campaignRow?: Record<string, unknown> | null;
  /** fetchPending 응답 */
  pendingRows?: Array<{ id: string; phone: string }>;
  /** hasPending 카운트 */
  remainingCount?: number;
  /** determineFinalStatus 카운트 (발송됨 row 수) */
  okCount?: number;
  /** loadCampaign 호출 시 throw 시킬지 */
  throwOnLoadCampaign?: boolean;
}

interface FakeSupabaseHandle {
  client: unknown;
  rpcCalls: RpcCall[];
  fromCalls: FromCall[];
  messageUpdates: Array<{ id: string; patch: Record<string, unknown> }>;
  campaignUpdates: Array<Record<string, unknown>>;
}

function makeFakeSupabase(opts: FakeSupabaseOptions): FakeSupabaseHandle {
  const rpcCalls: RpcCall[] = [];
  const fromCalls: FromCall[] = [];
  const messageUpdates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const campaignUpdates: Array<Record<string, unknown>> = [];

  const rpc = vi.fn(
    async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === "try_lock_campaign") {
        return { data: opts.lockResult, error: null };
      }
      if (fn === "unlock_campaign") {
        return { data: true, error: null };
      }
      return { data: null, error: { message: `unknown rpc ${fn}` } };
    },
  );

  // .from(table) 빌더 — 호출 체인을 흉내낸다.
  const from = (table: string) => {
    fromCalls.push({ table, op: "select", args: [] });

    // ── messages 분기 ─────────────────────────────────────
    if (table === "messages") {
      // 셀렉트 빌더
      const select = (
        cols: string,
        countOpts?: { count?: string; head?: boolean },
      ) => {
        // hasPending 패턴: select('id', {count:'exact', head:true}).eq().eq()
        if (countOpts && countOpts.count === "exact") {
          // 첫 번째 .eq() 는 campaign_id, 두 번째 .eq() 는 status
          // determineFinalStatus 도 같은 패턴 — status 로 분기
          let lastStatus: string | null = null;
          const builder = {
            eq(col: string, val: string) {
              if (col === "status") lastStatus = val;
              return Promise.resolve({
                count:
                  lastStatus === "발송됨"
                    ? (opts.okCount ?? 0)
                    : lastStatus === "대기"
                      ? (opts.remainingCount ?? 0)
                      : 0,
                error: null,
              }) as unknown as Promise<{ count: number; error: null }> & {
                eq: (c: string, v: string) => unknown;
              };
            },
          };
          // .eq() 두 번 체이닝되도록 thenable 가 아니라 builder 자체를 .eq 두 번 호출 가능하게 해야.
          // 위 구조는 첫 .eq() 가 Promise 를 반환해서 두 번째 .eq() 가 안 됨 → 수정.
          const chainable: {
            _status: string | null;
            eq: (col: string, val: string) => typeof chainable | Promise<{ count: number; error: null }>;
            then: (onFulfilled: (v: { count: number; error: null }) => unknown) => unknown;
          } = {
            _status: null,
            eq(col: string, val: string) {
              if (col === "status") this._status = val;
              return this;
            },
            then(onFulfilled) {
              const status = this._status;
              const count =
                status === "발송됨"
                  ? (opts.okCount ?? 0)
                  : status === "대기"
                    ? (opts.remainingCount ?? 0)
                    : 0;
              return Promise.resolve({ count, error: null }).then(
                onFulfilled,
              );
            },
          };
          return chainable;
        }

        // fetchPending 패턴: select('id, phone').eq().eq().order().limit()
        const pendingChain: {
          eq: (col: string, val: string) => typeof pendingChain;
          order: (col: string, opts: { ascending: boolean }) => typeof pendingChain;
          limit: (n: number) => Promise<{
            data: Array<{ id: string; phone: string }>;
            error: null;
          }>;
        } = {
          eq() {
            return pendingChain;
          },
          order() {
            return pendingChain;
          },
          limit() {
            return Promise.resolve({
              data: opts.pendingRows ?? [],
              error: null,
            });
          },
        };
        return pendingChain;
      };

      const update = (patch: Record<string, unknown>) => ({
        eq: (_col: string, val: string) => {
          messageUpdates.push({ id: val, patch });
          return Promise.resolve({ error: null });
        },
      });

      return { select, update };
    }

    // ── campaigns 분기 ───────────────────────────────────
    if (table === "campaigns") {
      const select = (_cols: string) => ({
        eq: (_col: string, _val: string) => ({
          maybeSingle: () => {
            if (opts.throwOnLoadCampaign) {
              return Promise.reject(new Error("loadCampaign forced throw"));
            }
            return Promise.resolve({
              data:
                opts.campaignRow === undefined
                  ? defaultCampaignRow()
                  : opts.campaignRow,
              error: null,
            });
          },
        }),
      });

      const update = (patch: Record<string, unknown>) => ({
        eq: (_col: string, _val: string) => {
          campaignUpdates.push(patch);
          return Promise.resolve({ error: null });
        },
      });

      return { select, update };
    }

    // 알 수 없는 테이블은 안전하게 빈 응답
    return {
      select: () => ({
        eq: () => Promise.resolve({ data: null, error: null }),
      }),
      update: () => ({
        eq: () => Promise.resolve({ error: null }),
      }),
    };
  };

  const client = { rpc, from };

  return { client, rpcCalls, fromCalls, messageUpdates, campaignUpdates };
}

function defaultCampaignRow(): Record<string, unknown> {
  return {
    id: "00000000-0000-0000-0000-000000000abc",
    status: "발송중",
    body: "안녕하세요 세정학원입니다",
    type: "SMS",
    is_ad: false,
    subject: null,
    total_cost: 0,
  };
}

// ─── 픽스처 ────────────────────────────────────────────────────

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  // sendon 발신번호 더미 (readFromNumber 통과용)
  process.env.SENDON_FROM_NUMBER = "01000000000";
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── 시나리오 1 — 락 미획득 시 즉시 종료 ────────────────────────

describe("drainCampaignChunk · advisory lock 미획득 시 즉시 종료", () => {
  it("try_lock_campaign=false → 어댑터·DB 미접근, lockSkipped=true 로 종료", async () => {
    const fake = makeFakeSupabase({ lockResult: false });
    (createSupabaseServiceClient as unknown as Mock).mockReturnValue(
      fake.client,
    );

    const adapterSend = vi.fn();
    (createSmsAdapter as unknown as Mock).mockReturnValue({
      name: "sendon",
      send: adapterSend,
      queryStatus: vi.fn(),
    });

    const result = await drainCampaignChunk(CAMPAIGN_ID);

    // 결과 형태
    expect(result).toEqual({
      campaignId: CAMPAIGN_ID,
      attempted: 0,
      sent: 0,
      failed: 0,
      hasMore: true,
      addedCost: 0,
      campaignDone: false,
      lockSkipped: true,
    });

    // 어댑터 호출 0회
    expect(adapterSend).not.toHaveBeenCalled();

    // RPC 호출은 try_lock 한 번만 — unlock 도 호출되지 않음
    const lockCalls = fake.rpcCalls.filter(
      (c) => c.fn === "try_lock_campaign",
    );
    const unlockCalls = fake.rpcCalls.filter(
      (c) => c.fn === "unlock_campaign",
    );
    expect(lockCalls).toHaveLength(1);
    expect(unlockCalls).toHaveLength(0);

    // messages / campaigns 테이블 어떤 op 도 일어나지 않아야 함
    expect(fake.fromCalls).toHaveLength(0);
    expect(fake.messageUpdates).toHaveLength(0);
    expect(fake.campaignUpdates).toHaveLength(0);
  });

  it("try_lock_campaign 이 RPC 에러 반환 → 보수적으로 락 미획득 처리", async () => {
    const rpc = vi.fn(async (fn: string) => {
      if (fn === "try_lock_campaign") {
        return { data: null, error: { message: "boom" } };
      }
      return { data: null, error: null };
    });
    const fakeClient = {
      rpc,
      from: vi.fn(() => {
        throw new Error("락 미획득인데 from() 가 호출되면 안 됨");
      }),
    };
    (createSupabaseServiceClient as unknown as Mock).mockReturnValue(
      fakeClient,
    );
    const adapterSend = vi.fn();
    (createSmsAdapter as unknown as Mock).mockReturnValue({
      name: "sendon",
      send: adapterSend,
      queryStatus: vi.fn(),
    });

    const result = await drainCampaignChunk(CAMPAIGN_ID);
    expect(result.lockSkipped).toBe(true);
    expect(result.hasMore).toBe(true);
    expect(adapterSend).not.toHaveBeenCalled();

    // unlock 도 안 호출
    const unlockCalled = rpc.mock.calls.some(
      (args) => args[0] === "unlock_campaign",
    );
    expect(unlockCalled).toBe(false);
  });
});

// ─── 시나리오 2 — 락 획득 시 정상 진행 + 종료 시 unlock ───────

describe("drainCampaignChunk · 락 획득 → 정상 발송 후 unlock", () => {
  it("pending 1건 + sendon 성공 → sent=1, unlock_campaign 1회 호출", async () => {
    const fake = makeFakeSupabase({
      lockResult: true,
      campaignRow: defaultCampaignRow(),
      pendingRows: [
        { id: "msg-1", phone: "01011112222" },
      ],
      remainingCount: 0, // 청크 후 더 이상 대기 없음
      okCount: 1,
    });
    (createSupabaseServiceClient as unknown as Mock).mockReturnValue(
      fake.client,
    );

    interface SentReq {
      to: string;
      body: string;
      type: string;
      fromNumber: string;
    }
    const adapterSend = vi.fn(async (_req: SentReq) => ({
      status: "queued" as const,
      vendorMessageId: "vendor-xyz",
      cost: 7.4,
    }));
    (createSmsAdapter as unknown as Mock).mockReturnValue({
      name: "sendon",
      send: adapterSend,
      queryStatus: vi.fn(),
    });

    const result = await drainCampaignChunk(CAMPAIGN_ID);

    expect(result.lockSkipped).toBe(false);
    expect(result.attempted).toBe(1);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.hasMore).toBe(false);
    expect(result.campaignDone).toBe(true);

    // 어댑터 1회 호출 + 본문/발신번호 매개 확인
    expect(adapterSend).toHaveBeenCalledTimes(1);
    const sentReq = adapterSend.mock.calls[0]?.[0];
    expect(sentReq).toBeDefined();
    if (!sentReq) throw new Error("unreachable");
    expect(sentReq.to).toBe("01011112222");
    expect(sentReq.fromNumber).toBe("01000000000");
    expect(sentReq.type).toBe("SMS");

    // unlock_campaign 정확히 1회
    const unlockCalls = fake.rpcCalls.filter(
      (c) => c.fn === "unlock_campaign",
    );
    expect(unlockCalls).toHaveLength(1);
    expect(unlockCalls[0]?.args).toEqual({
      p_campaign_id: CAMPAIGN_ID,
    });

    // messages.update 가 1회 일어나 status='발송됨' 로 마킹됐는지
    expect(fake.messageUpdates).toHaveLength(1);
    expect(fake.messageUpdates[0]?.patch.status).toBe("발송됨");
    expect(fake.messageUpdates[0]?.patch.vendor_message_id).toBe("vendor-xyz");

    // campaigns 마감 update 가 들어갔는지 (status='완료')
    const finalStatusUpdate = fake.campaignUpdates.find(
      (u) => u.status === "완료",
    );
    expect(finalStatusUpdate).toBeTruthy();
  });
});

// ─── 시나리오 3 — 락 획득 후 throw → finally 에서 unlock ─────

describe("drainCampaignChunk · 발송 중 throw 발생해도 unlock (try/finally)", () => {
  it("loadCampaign 단계에서 throw → 예외 propagate + unlock_campaign 호출", async () => {
    const fake = makeFakeSupabase({
      lockResult: true,
      throwOnLoadCampaign: true,
    });
    (createSupabaseServiceClient as unknown as Mock).mockReturnValue(
      fake.client,
    );

    const adapterSend = vi.fn();
    (createSmsAdapter as unknown as Mock).mockReturnValue({
      name: "sendon",
      send: adapterSend,
      queryStatus: vi.fn(),
    });

    await expect(drainCampaignChunk(CAMPAIGN_ID)).rejects.toThrow(
      /loadCampaign forced throw/,
    );

    // 어댑터는 호출되지 않았어야 함 (loadCampaign 직후 throw 라)
    expect(adapterSend).not.toHaveBeenCalled();

    // 그래도 unlock 은 finally 에서 호출됐어야 함
    const unlockCalls = fake.rpcCalls.filter(
      (c) => c.fn === "unlock_campaign",
    );
    expect(unlockCalls).toHaveLength(1);
  });
});
