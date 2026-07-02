import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * 발송 실패 앱 내 알림 · 데이터 레이어 회귀 테스트.
 *
 * 대상: src/lib/notifications/failed-campaign-alerts.ts
 *   - getFailedCampaignAlerts()  → 세션(서버) 클라이언트로 읽기(RLS 스코프)
 *   - acknowledgeFailedCampaigns() → 서비스 클라이언트로 UPDATE(앱단 스코프 가드)
 *
 * 마이그(failure_acknowledged_at, 0105) 실 DB 검증이 아니라 supabase 체인 호출
 * 인자를 캡처해 다음을 방어한다:
 *   1) 읽기 3종 필터(status='실패' / failure_acknowledged_at IS NULL / is_test=false)
 *      + order(created_at desc) + limit(20) + camelCase 매핑
 *   2) 확인 UPDATE 의 **스코프 가드** — 비마스터는 created_by=본인 강제,
 *      마스터는 미첨부. (남의 실패건 확인 차단 = 보안 핵심)
 *
 * supabase 모킹은 send-dashboard / cancel-scheduled-campaign 관례를 따르되,
 * 이 모듈은 체이닝 쿼리빌더(.select().eq().is()...limit / .update()...select)
 * 라서 각 메서드 호출을 기록하는 chainable recorder 를 vi.hoisted 로 주입한다.
 */

const h = vi.hoisted(() => {
  type Call = { m: string; args: unknown[] };
  const state = {
    // 읽기(서버 클라이언트) 관찰
    serverClientCount: 0,
    readFromTables: [] as string[],
    readCalls: [] as Call[],
    readResult: { data: null as unknown, error: null as unknown },

    // 확인(서비스 클라이언트) 관찰
    serviceClientCount: 0,
    updateFromTables: [] as string[],
    updateValue: null as Record<string, unknown> | null,
    updateCalls: [] as Call[],
    updateSelectCols: null as string | null,
    updateResult: { data: null as unknown, error: null as unknown },
  };

  // 읽기 체인: select/eq/is/order 는 self, limit 는 종단(Promise).
  function makeReadChain() {
    const chain = {
      eq(...args: unknown[]) {
        state.readCalls.push({ m: "eq", args });
        return chain;
      },
      is(...args: unknown[]) {
        state.readCalls.push({ m: "is", args });
        return chain;
      },
      order(...args: unknown[]) {
        state.readCalls.push({ m: "order", args });
        return chain;
      },
      limit(...args: unknown[]) {
        state.readCalls.push({ m: "limit", args });
        return Promise.resolve(state.readResult);
      },
    };
    return chain;
  }

  // UPDATE 체인: eq/is/in 은 self, select 는 종단(Promise).
  function makeUpdateChain() {
    const chain = {
      eq(...args: unknown[]) {
        state.updateCalls.push({ m: "eq", args });
        return chain;
      },
      is(...args: unknown[]) {
        state.updateCalls.push({ m: "is", args });
        return chain;
      },
      in(...args: unknown[]) {
        state.updateCalls.push({ m: "in", args });
        return chain;
      },
      select(cols: string) {
        state.updateSelectCols = cols;
        return Promise.resolve(state.updateResult);
      },
    };
    return chain;
  }

  const createServerMock = vi.fn(async () => {
    state.serverClientCount += 1;
    return {
      from(table: string) {
        state.readFromTables.push(table);
        return {
          select(...args: unknown[]) {
            state.readCalls.push({ m: "select", args });
            return makeReadChain();
          },
        };
      },
    };
  });

  const createServiceMock = vi.fn(() => {
    state.serviceClientCount += 1;
    return {
      from(table: string) {
        state.updateFromTables.push(table);
        return {
          update(v: Record<string, unknown>) {
            state.updateValue = v;
            return makeUpdateChain();
          },
        };
      },
    };
  });

  return { state, createServerMock, createServiceMock };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: h.createServerMock,
  createSupabaseServiceClient: h.createServiceMock,
}));

import {
  getFailedCampaignAlerts,
  acknowledgeFailedCampaigns,
  type FailedCampaignAlert,
} from "@/lib/notifications/failed-campaign-alerts";

function resetState() {
  const s = h.state;
  s.serverClientCount = 0;
  s.readFromTables = [];
  s.readCalls = [];
  s.readResult = { data: null, error: null };
  s.serviceClientCount = 0;
  s.updateFromTables = [];
  s.updateValue = null;
  s.updateCalls = [];
  s.updateSelectCols = null;
  s.updateResult = { data: null, error: null };
}

// 호출 목록에서 특정 메서드의 args 튜플들만 뽑는 헬퍼.
function argsOf(calls: { m: string; args: unknown[] }[], m: string) {
  return calls.filter((c) => c.m === m).map((c) => c.args);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetState();
});

// ─── 1. getFailedCampaignAlerts ───────────────────────────────

describe("getFailedCampaignAlerts", () => {
  describe("쿼리 구성(세션 클라이언트 · 필터 3종 · order · limit)", () => {
    it("세션(서버) 클라이언트로 crm_campaigns 를 조회한다(서비스 클라이언트 미사용)", async () => {
      h.state.readResult = { data: [], error: null };
      await getFailedCampaignAlerts();

      expect(h.state.serverClientCount).toBe(1);
      expect(h.state.serviceClientCount).toBe(0);
      expect(h.state.readFromTables).toEqual(["crm_campaigns"]);
    });

    it("select 컬럼·필터 3종·order desc·limit 20 이 정확히 걸린다", async () => {
      h.state.readResult = { data: [], error: null };
      await getFailedCampaignAlerts();

      // select 컬럼
      expect(argsOf(h.state.readCalls, "select")).toEqual([
        ["id, title, branch, created_at, total_recipients"],
      ]);

      // eq 필터: status='실패', is_test=false
      expect(argsOf(h.state.readCalls, "eq")).toEqual([
        ["status", "실패"],
        ["is_test", false],
      ]);

      // is 필터: failure_acknowledged_at IS NULL
      expect(argsOf(h.state.readCalls, "is")).toEqual([
        ["failure_acknowledged_at", null],
      ]);

      // order: created_at 내림차순
      expect(argsOf(h.state.readCalls, "order")).toEqual([
        ["created_at", { ascending: false }],
      ]);

      // limit: 20
      expect(argsOf(h.state.readCalls, "limit")).toEqual([[20]]);
    });
  });

  describe("행 매핑(camelCase)", () => {
    it("snake_case 행을 {id,title,branch,createdAt,totalRecipients} 로 매핑한다", async () => {
      h.state.readResult = {
        data: [
          {
            id: "c-1",
            title: "6월 정기 안내",
            branch: "대치",
            created_at: "2026-06-30T10:00:00+09:00",
            total_recipients: 132,
          },
        ],
        error: null,
      };

      const rows = await getFailedCampaignAlerts();
      expect(rows).toEqual<FailedCampaignAlert[]>([
        {
          id: "c-1",
          title: "6월 정기 안내",
          branch: "대치",
          createdAt: "2026-06-30T10:00:00+09:00",
          totalRecipients: 132,
        },
      ]);
    });

    it("total_recipients 가 null 이면 totalRecipients=0 으로 보정한다", async () => {
      h.state.readResult = {
        data: [
          {
            id: "c-2",
            title: "제목",
            branch: "송도",
            created_at: "2026-06-29T09:00:00+09:00",
            total_recipients: null,
          },
        ],
        error: null,
      };

      const rows = await getFailedCampaignAlerts();
      expect(rows[0].totalRecipients).toBe(0);
    });
  });

  describe("경계값 · 에러", () => {
    it("data=null → 빈 배열", async () => {
      h.state.readResult = { data: null, error: null };
      expect(await getFailedCampaignAlerts()).toEqual([]);
    });

    it("빈 결과 → 빈 배열", async () => {
      h.state.readResult = { data: [], error: null };
      expect(await getFailedCampaignAlerts()).toEqual([]);
    });

    it("조회 에러 → 한국어 메시지로 throw", async () => {
      h.state.readResult = { data: null, error: { message: "권한 없음" } };
      await expect(getFailedCampaignAlerts()).rejects.toThrow(
        "발송 실패 알림 조회에 실패했습니다: 권한 없음",
      );
    });
  });
});

// ─── 2. acknowledgeFailedCampaigns · 스코프 가드(보안 핵심) ─────

const MASTER = { role: "master" as const, user_id: "u-master" };
const MANAGER = { role: "manager" as const, user_id: "u-mgr" };

describe("acknowledgeFailedCampaigns", () => {
  describe("스코프 가드(created_by)", () => {
    it("master + 'all' → 서비스 클라이언트 UPDATE, created_by 필터 없음, 필터 3종만", async () => {
      h.state.updateResult = { data: [{ id: "c-1" }], error: null };

      const r = await acknowledgeFailedCampaigns("all", MASTER);

      expect(r).toEqual({ acknowledged: 1 });
      // 서비스 클라이언트 사용(세션 아님)
      expect(h.state.serviceClientCount).toBe(1);
      expect(h.state.serverClientCount).toBe(0);
      expect(h.state.updateFromTables).toEqual(["crm_campaigns"]);

      // UPDATE 값: failure_acknowledged_at 채움
      expect(h.state.updateValue).not.toBeNull();
      expect(
        typeof h.state.updateValue?.failure_acknowledged_at,
      ).toBe("string");

      // 필터 3종: status='실패', is_test=false + is NULL. created_by 없음.
      expect(argsOf(h.state.updateCalls, "eq")).toEqual([
        ["status", "실패"],
        ["is_test", false],
      ]);
      expect(argsOf(h.state.updateCalls, "is")).toEqual([
        ["failure_acknowledged_at", null],
      ]);
      // 'all' 이므로 id IN 없음
      expect(argsOf(h.state.updateCalls, "in")).toEqual([]);
      // 종단 select('id')
      expect(h.state.updateSelectCols).toBe("id");
    });

    it("manager(비마스터) + 'all' → created_by=본인 user_id 필터가 추가된다", async () => {
      h.state.updateResult = { data: [{ id: "c-1" }], error: null };

      await acknowledgeFailedCampaigns("all", MANAGER);

      // created_by 가드가 마지막 eq 로 붙는다
      expect(argsOf(h.state.updateCalls, "eq")).toEqual([
        ["status", "실패"],
        ["is_test", false],
        ["created_by", "u-mgr"],
      ]);
    });

    it("비마스터는 created_by 로 남의 실패건을 확인하지 못하도록 항상 스코프된다", async () => {
      h.state.updateResult = { data: [], error: null };
      await acknowledgeFailedCampaigns(["c-1", "c-2"], MANAGER);

      const createdByFilters = argsOf(h.state.updateCalls, "eq").filter(
        (a) => a[0] === "created_by",
      );
      expect(createdByFilters).toEqual([["created_by", "u-mgr"]]);
    });
  });

  describe("campaignIds 처리", () => {
    it("배열 → id IN (...) 필터가 추가된다", async () => {
      h.state.updateResult = { data: [{ id: "c-1" }, { id: "c-2" }], error: null };

      const r = await acknowledgeFailedCampaigns(["c-1", "c-2"], MASTER);

      expect(r).toEqual({ acknowledged: 2 });
      expect(argsOf(h.state.updateCalls, "in")).toEqual([
        ["id", ["c-1", "c-2"]],
      ]);
    });

    it("빈 배열 → UPDATE 미실행, 서비스 클라이언트 생성 안 함, {acknowledged:0}", async () => {
      const r = await acknowledgeFailedCampaigns([], MASTER);

      expect(r).toEqual({ acknowledged: 0 });
      expect(h.state.serviceClientCount).toBe(0);
      expect(h.state.updateFromTables).toEqual([]);
      expect(h.state.updateCalls).toEqual([]);
    });
  });

  describe("viewer 가드 · 반환값", () => {
    it("viewer=null → UPDATE 미실행, {acknowledged:0}", async () => {
      const r = await acknowledgeFailedCampaigns("all", null);

      expect(r).toEqual({ acknowledged: 0 });
      expect(h.state.serviceClientCount).toBe(0);
      expect(h.state.updateCalls).toEqual([]);
    });

    it("select('id') 결과 길이가 acknowledged 로 반환된다", async () => {
      h.state.updateResult = {
        data: [{ id: "a" }, { id: "b" }, { id: "c" }],
        error: null,
      };
      const r = await acknowledgeFailedCampaigns("all", MASTER);
      expect(r).toEqual({ acknowledged: 3 });
    });

    it("data=null → acknowledged=0", async () => {
      h.state.updateResult = { data: null, error: null };
      const r = await acknowledgeFailedCampaigns("all", MASTER);
      expect(r).toEqual({ acknowledged: 0 });
    });

    it("UPDATE 에러 → 한국어 메시지로 throw", async () => {
      h.state.updateResult = { data: null, error: { message: "실패 사유" } };
      await expect(
        acknowledgeFailedCampaigns("all", MASTER),
      ).rejects.toThrow("발송 실패 알림 확인에 실패했습니다: 실패 사유");
    });
  });
});
