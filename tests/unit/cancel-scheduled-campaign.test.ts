import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * 예약 발송 취소 (lib) · 정확성·병렬·백그라운드 회귀 테스트.
 *
 * 대상: src/lib/messaging/cancel-scheduled-campaign.ts `cancelScheduledCampaign`.
 *
 * 배경(수정된 버그):
 *   과거엔 취소할 sendon groupId 를 `crm_messages.select(vendor_message_id)` 로
 *   읽었는데, PostgREST max_rows(1000) 에 잘려 대형 예약에서 일부 groupId 를
 *   놓쳐 → "취소 표시됐지만 실제로는 발송되는" 사고가 났다. 수정본은 DISTINCT
 *   RPC `crm_campaign_reservation_group_ids` 로 전체 groupId 를 확보한다.
 *
 * 이 파일은 lib 함수의 전체 경로(가드 통과 → RPC → 병렬 취소 → 캠페인 UPDATE →
 *   waitUntil 메시지 정리)를 의존성 모킹으로 재현해 다음을 방어한다:
 *     1. RPC 가 돌려준 모든 groupId 로 정확히 그 횟수만큼 cancel 호출(잘림 없음)
 *     2. crm_messages.select 로는 읽지 않음(버그 재발 차단)
 *     3. sendon 취소 실패 시 DB 무변경(캠페인 UPDATE·waitUntil 미호출)
 *     4. 메시지 정리는 백그라운드(waitUntil) — await 하지 않고 즉시 반환
 *
 * ⚠️ vi.mock 은 파일 전역 호이스팅이므로 가드 단위만 보는
 *    cancel-scheduled-guards.test.ts 와 분리해 독립 파일로 둔다.
 */

const CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";

// 테스트마다 갈아끼우는 가변 상태 + 스파이. vi.mock 팩토리(호이스팅)가 참조할 수
// 있도록 vi.hoisted 로 끌어올린다.
const h = vi.hoisted(() => {
  const state = {
    devSeed: false,
    campaign: null as Record<string, unknown> | null,
    user: null as Record<string, unknown> | null,
    canResult: true,

    // RPC 결과
    rpcRows: null as { vendor_message_id: string | null }[] | null,
    rpcError: null as { message: string } | null,

    // 캠페인 UPDATE 결과
    campaignUpdateData: null as { id: string }[] | null,
    campaignUpdateError: null as { message: string } | null,

    // sendon cancel 구현(groupId → 결과)
    cancelImpl: (_gid: string) =>
      Promise.resolve({ status: "cancelled" } as {
        status: string;
        reason?: string;
      }),

    // crm_messages 정리 게이트(백그라운드 증명용). resolve 를 부를 때까지 대기.
    msgGate: null as Promise<void> | null,

    // 관찰 기록
    fromTables: [] as string[],
    fromSelectTables: [] as string[],
    rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
    campaignUpdateCalled: false,
    campaignUpdateValue: null as Record<string, unknown> | null,
    campaignUpdateEqs: [] as { c: string; v: string }[],
    campaignUpdateSelectCols: null as string | null,
    msgUpdateCalled: false,
    msgUpdateValue: null as Record<string, unknown> | null,
    msgUpdateEq: null as { c: string; v: string } | null,
    waitUntilPromise: null as Promise<unknown> | null,
    adapterBranch: null as string | null | undefined,
  };

  const cancelSpy = vi.fn((gid: string) => state.cancelImpl(gid));
  const waitUntilSpy = vi.fn((p: Promise<unknown>) => {
    state.waitUntilPromise = p;
  });

  function makeSupabase() {
    return {
      rpc(fn: string, args: Record<string, unknown>) {
        state.rpcCalls.push({ fn, args });
        return Promise.resolve({ data: state.rpcRows, error: state.rpcError });
      },
      from(table: string) {
        state.fromTables.push(table);
        return {
          // 코드가 RPC 대신 select 로 읽으면(=버그 재발) 여기 걸린다.
          select(_cols: string) {
            state.fromSelectTables.push(table);
            return {
              eq: () => Promise.resolve({ data: [], error: null }),
            };
          },
          update(v: Record<string, unknown>) {
            if (table === "crm_campaigns") {
              state.campaignUpdateCalled = true;
              state.campaignUpdateValue = v;
              return {
                eq(c1: string, v1: string) {
                  state.campaignUpdateEqs.push({ c: c1, v: v1 });
                  return {
                    eq(c2: string, v2: string) {
                      state.campaignUpdateEqs.push({ c: c2, v: v2 });
                      return {
                        select(cols: string) {
                          state.campaignUpdateSelectCols = cols;
                          return Promise.resolve({
                            data: state.campaignUpdateData,
                            error: state.campaignUpdateError,
                          });
                        },
                      };
                    },
                  };
                },
              };
            }
            // crm_messages 정리
            state.msgUpdateCalled = true;
            state.msgUpdateValue = v;
            return {
              eq(c: string, val: string) {
                state.msgUpdateEq = { c, v: val };
                return state.msgGate
                  ? state.msgGate.then(() => ({ error: null }))
                  : Promise.resolve({ error: null });
              },
            };
          },
        };
      },
    };
  }

  return { state, cancelSpy, waitUntilSpy, makeSupabase };
});

vi.mock("@/lib/profile/students-dev-seed", () => ({
  isDevSeedMode: () => h.state.devSeed,
}));
vi.mock("@/lib/campaigns/get-campaign", () => ({
  getCampaign: vi.fn(async () => h.state.campaign),
}));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(async () => h.state.user),
}));
vi.mock("@/lib/auth/can", () => ({
  can: vi.fn(() => h.state.canResult),
}));
vi.mock("@/lib/messaging/adapters", () => ({
  createSmsAdapter: vi.fn((branch?: string | null) => {
    h.state.adapterBranch = branch;
    return { cancel: h.cancelSpy };
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: vi.fn(() => h.makeSupabase()),
}));
vi.mock("@vercel/functions", () => ({
  waitUntil: h.waitUntilSpy,
}));

// 호이스팅된 모킹 이후에 대상 모듈을 로드.
async function load() {
  const mod = await import("@/lib/messaging/cancel-scheduled-campaign");
  return mod.cancelScheduledCampaign;
}

// 가변 상태를 매 테스트 happy-path 기본값으로 리셋.
function resetState() {
  const s = h.state;
  s.devSeed = false;
  s.campaign = { id: CAMPAIGN_ID, branch: "대치", status: "예약됨" };
  s.user = {
    user_id: "u-1",
    role: "master",
    branch: "대치",
    active: true,
  };
  s.canResult = true;
  s.rpcRows = [];
  s.rpcError = null;
  s.campaignUpdateData = [{ id: CAMPAIGN_ID }];
  s.campaignUpdateError = null;
  s.cancelImpl = (_gid: string) => Promise.resolve({ status: "cancelled" });
  s.msgGate = null;
  s.fromTables = [];
  s.fromSelectTables = [];
  s.rpcCalls = [];
  s.campaignUpdateCalled = false;
  s.campaignUpdateValue = null;
  s.campaignUpdateEqs = [];
  s.campaignUpdateSelectCols = null;
  s.msgUpdateCalled = false;
  s.msgUpdateValue = null;
  s.msgUpdateEq = null;
  s.waitUntilPromise = null;
  s.adapterBranch = null;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetState();
});

describe("cancelScheduledCampaign", () => {
  describe("정확성 (RPC groupId 잘림 없음)", () => {
    it("RPC 가 groupId 5개를 주면 cancel 이 정확히 5번, 각 groupId 로 호출된다", async () => {
      const gids = ["g1", "g2", "g3", "g4", "g5"];
      h.state.rpcRows = gids.map((v) => ({ vendor_message_id: v }));

      const cancel = await load();
      const r = await cancel(CAMPAIGN_ID);

      expect(r.status).toBe("cancelled");
      expect(h.cancelSpy).toHaveBeenCalledTimes(5);
      const calledWith = h.cancelSpy.mock.calls.map((c) => c[0]).sort();
      expect(calledWith).toEqual([...gids].sort());
    });

    it("groupId 는 crm_messages.select 가 아니라 DISTINCT RPC 로 읽는다", async () => {
      h.state.rpcRows = [{ vendor_message_id: "g1" }];

      const cancel = await load();
      await cancel(CAMPAIGN_ID);

      // RPC 로 정확한 이름·인자 호출
      expect(h.state.rpcCalls).toEqual([
        {
          fn: "crm_campaign_reservation_group_ids",
          args: { p_campaign_id: CAMPAIGN_ID },
        },
      ]);
      // crm_messages 를 select 로 읽지 않았다(버그 재발 차단)
      expect(h.state.fromSelectTables).not.toContain("crm_messages");
      expect(h.state.fromSelectTables).toHaveLength(0);
    });

    it("null/빈 vendor_message_id 는 걸러내고 유효한 것만 취소한다", async () => {
      h.state.rpcRows = [
        { vendor_message_id: "g1" },
        { vendor_message_id: null },
        { vendor_message_id: "" },
        { vendor_message_id: "g2" },
      ];

      const cancel = await load();
      const r = await cancel(CAMPAIGN_ID);

      expect(r.status).toBe("cancelled");
      expect(h.cancelSpy).toHaveBeenCalledTimes(2);
      expect(h.cancelSpy.mock.calls.map((c) => c[0]).sort()).toEqual([
        "g1",
        "g2",
      ]);
    });

    it("취소할 예약이 0건이어도(빈 RPC) 캠페인은 정상 취소된다", async () => {
      h.state.rpcRows = [];

      const cancel = await load();
      const r = await cancel(CAMPAIGN_ID);

      expect(r.status).toBe("cancelled");
      expect(h.cancelSpy).not.toHaveBeenCalled();
      expect(h.state.campaignUpdateCalled).toBe(true);
    });
  });

  describe("병렬 취소 성공 경로", () => {
    beforeEach(() => {
      h.state.rpcRows = ["g1", "g2", "g3"].map((v) => ({
        vendor_message_id: v,
      }));
    });

    it("모든 cancel 성공 → 캠페인 UPDATE(예약됨 조건) + waitUntil 예약 + cancelled 반환", async () => {
      const cancel = await load();
      const r = await cancel(CAMPAIGN_ID);

      expect(r.status).toBe("cancelled");

      // 캠페인 원자적 UPDATE: status='취소', id=CAMPAIGN_ID AND status='예약됨', select('id')
      expect(h.state.campaignUpdateCalled).toBe(true);
      expect(h.state.campaignUpdateValue).toEqual({ status: "취소" });
      expect(h.state.campaignUpdateEqs).toEqual([
        { c: "id", v: CAMPAIGN_ID },
        { c: "status", v: "예약됨" },
      ]);
      expect(h.state.campaignUpdateSelectCols).toBe("id");

      // 메시지 정리는 waitUntil 로 예약(1회)
      expect(h.waitUntilSpy).toHaveBeenCalledTimes(1);
    });

    it("분원 기준으로 sendon 어댑터를 만든다", async () => {
      const cancel = await load();
      await cancel(CAMPAIGN_ID);
      expect(h.state.adapterBranch).toBe("대치");
    });
  });

  describe("sendon 취소 실패 → DB 무변경", () => {
    beforeEach(() => {
      h.state.rpcRows = ["g1", "g2", "g3"].map((v) => ({
        vendor_message_id: v,
      }));
    });

    it("cancel 중 하나라도 실패하면 failed 반환하고 캠페인 UPDATE·waitUntil 미호출", async () => {
      h.state.cancelImpl = (gid: string) =>
        Promise.resolve(
          gid === "g2"
            ? { status: "failed", reason: "발송 10분 전 초과" }
            : { status: "cancelled" },
        );

      const cancel = await load();
      const r = await cancel(CAMPAIGN_ID);

      expect(r.status).toBe("failed");
      if (r.status === "failed") {
        expect(r.reason).toContain("sendon 예약 취소 실패");
      }
      // DB 는 그대로: 예약이 발송될 수 있으므로 캠페인 상태 유지
      expect(h.state.campaignUpdateCalled).toBe(false);
      expect(h.waitUntilSpy).not.toHaveBeenCalled();
    });
  });

  describe("백그라운드(메시지 정리 비동기)", () => {
    it("메시지 정리가 미완료여도 함수는 즉시 cancelled 반환(await 하지 않음)", async () => {
      h.state.rpcRows = [{ vendor_message_id: "g1" }];
      // crm_messages 정리를 절대 resolve 되지 않게 게이트로 막는다.
      // 함수가 이를 await 했다면 이 테스트는 타임아웃 → 실패해야 정상.
      let releaseGate: () => void = () => {};
      h.state.msgGate = new Promise<void>((res) => {
        releaseGate = res;
      });

      const cancel = await load();
      const r = await cancel(CAMPAIGN_ID);

      // 게이트가 열리지 않았는데도 반환됨 = 백그라운드 처리 증명
      expect(r.status).toBe("cancelled");
      expect(h.waitUntilSpy).toHaveBeenCalledTimes(1);
      // waitUntil 에 넘긴 값은 Promise
      expect(h.state.waitUntilPromise).toBeInstanceOf(Promise);
      // 백그라운드 콜백이 crm_messages.update 를 이미 시작함(update() 동기 호출)
      expect(h.state.msgUpdateCalled).toBe(true);

      // 게이트 열고 백그라운드 프라미스 마무리 검증
      releaseGate();
      await h.state.waitUntilPromise;
    });

    it("백그라운드 콜백은 crm_messages 를 '실패'+'예약 취소' 로 campaign_id 기준 갱신한다", async () => {
      h.state.rpcRows = [{ vendor_message_id: "g1" }];

      const cancel = await load();
      const r = await cancel(CAMPAIGN_ID);
      expect(r.status).toBe("cancelled");

      // 백그라운드 프라미스 완료까지 대기
      await h.state.waitUntilPromise;

      expect(h.state.msgUpdateValue).toEqual({
        status: "실패",
        failed_reason: "예약 취소",
      });
      expect(h.state.msgUpdateEq).toEqual({ c: "campaign_id", v: CAMPAIGN_ID });
    });
  });

  describe("가드 (실패 시 sendon·DB 미접근)", () => {
    function assertNoSideEffects() {
      expect(h.cancelSpy).not.toHaveBeenCalled();
      expect(h.state.rpcCalls).toHaveLength(0);
      expect(h.state.fromTables).toHaveLength(0);
      expect(h.waitUntilSpy).not.toHaveBeenCalled();
    }

    it("dev-seed 모드 → dev_seed_mode, 아무 것도 호출 안 함", async () => {
      h.state.devSeed = true;
      const cancel = await load();
      const r = await cancel(CAMPAIGN_ID);
      expect(r.status).toBe("dev_seed_mode");
      assertNoSideEffects();
    });

    it("빈 campaignId → failed(캠페인 ID 유효하지 않음)", async () => {
      const cancel = await load();
      const r = await cancel("");
      expect(r.status).toBe("failed");
      if (r.status === "failed") expect(r.reason).toContain("캠페인 ID");
      assertNoSideEffects();
    });

    it("존재하지 않는 캠페인 → failed", async () => {
      h.state.campaign = null;
      const cancel = await load();
      const r = await cancel(CAMPAIGN_ID);
      expect(r.status).toBe("failed");
      if (r.status === "failed") expect(r.reason).toContain("존재하지 않는");
      assertNoSideEffects();
    });

    it("미로그인 → failed", async () => {
      h.state.user = null;
      const cancel = await load();
      const r = await cancel(CAMPAIGN_ID);
      expect(r.status).toBe("failed");
      if (r.status === "failed") expect(r.reason).toContain("로그인");
      assertNoSideEffects();
    });

    it("발송 권한 없음(can=false) → failed", async () => {
      h.state.canResult = false;
      const cancel = await load();
      const r = await cancel(CAMPAIGN_ID);
      expect(r.status).toBe("failed");
      if (r.status === "failed") expect(r.reason).toContain("권한");
      assertNoSideEffects();
    });

    it("status 가 '예약됨' 이 아니면 → failed", async () => {
      h.state.campaign = { id: CAMPAIGN_ID, branch: "대치", status: "발송완료" };
      const cancel = await load();
      const r = await cancel(CAMPAIGN_ID);
      expect(r.status).toBe("failed");
      if (r.status === "failed") expect(r.reason).toContain("예약 상태가 아니");
      assertNoSideEffects();
    });
  });

  describe("경합 (캠페인 UPDATE 0행)", () => {
    it("동시 취소로 갱신 행이 0이면 → failed + waitUntil 미호출", async () => {
      h.state.rpcRows = [{ vendor_message_id: "g1" }];
      h.state.campaignUpdateData = []; // 이미 다른 요청이 '취소' 로 바꿔 매칭 0행

      const cancel = await load();
      const r = await cancel(CAMPAIGN_ID);

      expect(r.status).toBe("failed");
      if (r.status === "failed") expect(r.reason).toContain("이미 처리되어");
      // sendon 취소는 성공했지만 메시지 정리는 예약하지 않는다
      expect(h.waitUntilSpy).not.toHaveBeenCalled();
    });
  });
});
