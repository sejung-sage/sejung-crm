import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * 발송 대시보드(마스터 전용) 데이터 레이어 · 순수 로직/가드 회귀 테스트.
 *
 * 마이그(0102) 미적용이라 RPC 실 호출은 불가 → supabase 클라이언트를 모킹해
 *   1) 필터 스키마의 견고성(searchParams 파싱 안전성),
 *   2) 마스터 1차 가드(비마스터면 RPC 미호출·빈 배열),
 *   3) 마스터일 때 RPC 파라미터(KST 경계 변환)·행 매핑(camelCase·Number 정규화)
 * 만 검증한다. DB·RLS·is_master() 2차 가드는 여기서 검증 대상이 아니다.
 *
 * supabase 모킹은 seminars-broadcast-name-guard.test.ts 관례
 * (`vi.mock("@/lib/supabase/server", ...)`)를 따르되, `.rpc` 호출을 캡처하기 위해
 * vi.hoisted 로 만든 스파이를 주입한다.
 */

const { rpcMock, createClientMock } = vi.hoisted(() => {
  const rpcMock = vi.fn();
  const createClientMock = vi.fn(async () => ({ rpc: rpcMock }));
  return { rpcMock, createClientMock };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: createClientMock,
}));

import {
  SendDashboardFilterSchema,
  getSendDashboard,
  type SendDashboardRow,
} from "@/lib/dashboard/send-dashboard";

// ─── 1. 필터 스키마 견고성 ──────────────────────────────────────

describe("SendDashboardFilterSchema · searchParams 파싱 안전성", () => {
  describe("기본값 복구", () => {
    it("빈 객체 → seminar='all', groupBy='month', 나머지는 undefined", () => {
      const p = SendDashboardFilterSchema.parse({});
      expect(p.seminar).toBe("all");
      expect(p.groupBy).toBe("month");
      expect(p.from).toBeUndefined();
      expect(p.to).toBeUndefined();
      expect(p.branch).toBeUndefined();
      expect(p.sender).toBeUndefined();
    });

    it("잘못된 seminar('xxx') → 'all' 로 복구(.catch)", () => {
      const p = SendDashboardFilterSchema.parse({ seminar: "xxx" });
      expect(p.seminar).toBe("all");
    });

    it("잘못된 groupBy('bad') → 'month' 로 복구(.catch)", () => {
      const p = SendDashboardFilterSchema.parse({ groupBy: "bad" });
      expect(p.groupBy).toBe("month");
    });

    it("branch 가 빈 문자열('') → min(1) 실패 → undefined 로 복구", () => {
      const p = SendDashboardFilterSchema.parse({ branch: "", sender: "" });
      expect(p.branch).toBeUndefined();
      expect(p.sender).toBeUndefined();
    });
  });

  describe("from/to 형식 검증", () => {
    it("비 'YYYY-MM-DD' 형식(슬래시·연속숫자·문자열) → undefined", () => {
      expect(SendDashboardFilterSchema.parse({ from: "2026/06/01" }).from).toBeUndefined();
      expect(SendDashboardFilterSchema.parse({ from: "20260601" }).from).toBeUndefined();
      expect(SendDashboardFilterSchema.parse({ from: "abc" }).from).toBeUndefined();
      expect(SendDashboardFilterSchema.parse({ to: "6/1/2026" }).to).toBeUndefined();
    });

    it("정상 from/to → 그대로 통과", () => {
      const p = SendDashboardFilterSchema.parse({
        from: "2026-06-01",
        to: "2026-06-30",
      });
      expect(p.from).toBe("2026-06-01");
      expect(p.to).toBe("2026-06-30");
    });

    it("형식은 맞지만 존재하지 않는 날짜('2026-13-99')는 undefined 로 떨군다", () => {
      // isoDate 는 정규식(4-2-2) 통과 후 달력 유효성(refine)까지 검증하므로
      // 13월 99일처럼 존재할 수 없는 날짜는 undefined 로 떨궈져 RPC 로 넘어가지 않는다.
      const p = SendDashboardFilterSchema.parse({ from: "2026-13-99" });
      expect(p.from).toBeUndefined();
    });

    it("형식은 맞지만 불가능한 월('2026-02-30')도 undefined 로 떨군다", () => {
      const p = SendDashboardFilterSchema.parse({ from: "2026-02-30" });
      expect(p.from).toBeUndefined();
    });
  });

  describe("정상·불량 혼합", () => {
    it("정상 branch/sender + 정상 enum → 모두 통과", () => {
      const p = SendDashboardFilterSchema.parse({
        from: "2026-06-01",
        to: "2026-06-30",
        branch: "대치",
        sender: "0212345678",
        seminar: "with",
        groupBy: "branch",
      });
      expect(p).toEqual({
        from: "2026-06-01",
        to: "2026-06-30",
        branch: "대치",
        sender: "0212345678",
        seminar: "with",
        groupBy: "branch",
      });
    });

    it("불량 값이 섞여도 throw 하지 않고 전부 복구된다(safeParse success)", () => {
      const r = SendDashboardFilterSchema.safeParse({
        from: "not-a-date",
        to: "2026-06-30",
        branch: "",
        seminar: 123,
        groupBy: null,
      });
      expect(r.success).toBe(true);
      if (r.success) {
        expect(r.data.from).toBeUndefined();
        expect(r.data.to).toBe("2026-06-30");
        expect(r.data.branch).toBeUndefined();
        expect(r.data.seminar).toBe("all");
        expect(r.data.groupBy).toBe("month");
      }
    });
  });
});

// ─── 2. getSendDashboard 마스터 가드 & RPC 매핑 ────────────────

const sampleRpcRows = [
  {
    group_key: "2026-06",
    group_label: "2026년 6월",
    msg_count: "5",
    total_cost: "37",
    sms_count: "3",
    lms_count: "2",
    alimtalk_count: "0",
  },
];

describe("getSendDashboard · 마스터 1차 가드", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.mockResolvedValue({ data: sampleRpcRows, error: null });
  });

  it("viewer=null → [] 반환, supabase 클라이언트·RPC 미호출", async () => {
    const rows = await getSendDashboard(SendDashboardFilterSchema.parse({}), null);
    expect(rows).toEqual([]);
    expect(createClientMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it.each(["viewer", "manager", "admin"] as const)(
    "role='%s'(비마스터) → [] 반환, RPC 미호출",
    async (role) => {
      const rows = await getSendDashboard(
        SendDashboardFilterSchema.parse({}),
        { role },
      );
      expect(rows).toEqual([]);
      expect(createClientMock).not.toHaveBeenCalled();
      expect(rpcMock).not.toHaveBeenCalled();
    },
  );
});

describe("getSendDashboard · 마스터 경로 RPC 파라미터/매핑", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.mockResolvedValue({ data: sampleRpcRows, error: null });
  });

  it("master → RPC 호출됨, from/to 가 KST 경계 timestamptz 로 변환되어 전달", async () => {
    const filters = SendDashboardFilterSchema.parse({
      from: "2026-06-01",
      to: "2026-06-30",
      branch: "대치",
      seminar: "with",
      groupBy: "branch",
    });

    await getSendDashboard(filters, { role: "master" });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("crm_send_dashboard", {
      p_from: "2026-06-01T00:00:00+09:00",
      p_to: "2026-06-30T23:59:59+09:00",
      p_branch: "대치",
      p_sender: null,
      p_seminar: "with",
      p_group_by: "branch",
    });
  });

  it("from/to 미지정 → p_from/p_to = null, branch/sender 미지정 → null", async () => {
    await getSendDashboard(SendDashboardFilterSchema.parse({}), { role: "master" });

    expect(rpcMock).toHaveBeenCalledWith("crm_send_dashboard", {
      p_from: null,
      p_to: null,
      p_branch: null,
      p_sender: null,
      p_seminar: "all",
      p_group_by: "month",
    });
  });

  it("snake_case bigint 문자열 행 → camelCase number 로 매핑(Number 변환)", async () => {
    const rows = await getSendDashboard(
      SendDashboardFilterSchema.parse({}),
      { role: "master" },
    );

    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r).toEqual<SendDashboardRow>({
      groupKey: "2026-06",
      groupLabel: "2026년 6월",
      msgCount: 5,
      totalCost: 37,
      smsCount: 3,
      lmsCount: 2,
      alimtalkCount: 0,
    });
    // 문자열이 아닌 number 로 정규화됐는지 명시 확인.
    expect(typeof r.msgCount).toBe("number");
    expect(typeof r.totalCost).toBe("number");
  });

  it("RPC 가 number 로 준 bigint 도 동일하게 매핑된다", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          group_key: "대치",
          group_label: "대치",
          msg_count: 12,
          total_cost: 288,
          sms_count: 0,
          lms_count: 12,
          alimtalk_count: 0,
        },
      ],
      error: null,
    });

    const rows = await getSendDashboard(
      SendDashboardFilterSchema.parse({ groupBy: "branch" }),
      { role: "master" },
    );
    expect(rows[0].msgCount).toBe(12);
    expect(rows[0].totalCost).toBe(288);
  });

  it("data 가 null 이어도 (data ?? []) → 빈 배열", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const rows = await getSendDashboard(
      SendDashboardFilterSchema.parse({}),
      { role: "master" },
    );
    expect(rows).toEqual([]);
  });

  it("RPC error → 한국어 메시지로 throw", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "권한 없음" } });
    await expect(
      getSendDashboard(SendDashboardFilterSchema.parse({}), { role: "master" }),
    ).rejects.toThrow("발송 대시보드 조회에 실패했습니다: 권한 없음");
  });
});

// ─── 3. 요약 합계 로직(컴포넌트 내부 로직 재현 검증) ────────────
//
// DashboardSummary 는 순수 export 함수가 아니라 서버 컴포넌트 내부 reduce 이고,
// 프로젝트에 jsdom/RTL 셋업이 없어(vitest environment: node) 렌더 테스트가 불가.
// 여기서는 컴포넌트가 사용하는 합산 규칙을 그대로 재현해 산술 정확성만 문서화한다.
// (컴포넌트 구현을 직접 가드하지는 못함 — 보고서에 한계 명시.)

function sumRows(rows: SendDashboardRow[]) {
  return rows.reduce(
    (acc, r) => {
      acc.msgCount += r.msgCount;
      acc.totalCost += r.totalCost;
      acc.smsCount += r.smsCount;
      acc.lmsCount += r.lmsCount;
      acc.alimtalkCount += r.alimtalkCount;
      return acc;
    },
    { msgCount: 0, totalCost: 0, smsCount: 0, lmsCount: 0, alimtalkCount: 0 },
  );
}

describe("발송 요약 합계 규칙(재현)", () => {
  it("빈 행 → 모든 합계 0", () => {
    expect(sumRows([])).toEqual({
      msgCount: 0,
      totalCost: 0,
      smsCount: 0,
      lmsCount: 0,
      alimtalkCount: 0,
    });
  });

  it("여러 행 합산 → 유형별·총 건수·총 금액이 정확히 sum", () => {
    const rows: SendDashboardRow[] = [
      {
        groupKey: "a",
        groupLabel: "A",
        msgCount: 5,
        totalCost: 37,
        smsCount: 3,
        lmsCount: 2,
        alimtalkCount: 0,
      },
      {
        groupKey: "b",
        groupLabel: "B",
        msgCount: 10,
        totalCost: 240,
        smsCount: 0,
        lmsCount: 10,
        alimtalkCount: 0,
      },
    ];
    expect(sumRows(rows)).toEqual({
      msgCount: 15,
      totalCost: 277,
      smsCount: 3,
      lmsCount: 12,
      alimtalkCount: 0,
    });
  });
});
