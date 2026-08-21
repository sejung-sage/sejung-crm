import { describe, it, expect, vi } from "vitest";

/**
 * getCampaign · 상세 화면이 읽는 컬럼의 패스스루 회귀 테스트.
 *
 * 배경(수정된 버그 · 2026-08-20 현장 발견):
 *   `getCampaign` 은 `select("*")` 로 행 전체를 가져오지만, 반환값은 컬럼을
 *   하나씩 나열해 만든 객체다. 0120(`failed_reason`)·0121(`send_filters`)이
 *   컬럼과 UI 를 추가하면서 **이 매퍼만 갱신되지 않았다**.
 *
 *   `CampaignListItem` 에서 두 필드가 optional(`?`) 이라 타입 검사도 통과했고,
 *   화면은 조용히 폴백으로 떨어졌다:
 *     - "실패 사유: 기록되지 않았습니다. 2026-08-11 이전 발송은 …" (DB 엔 값이 있음)
 *     - `send_filters == null` 로 판정돼 '같은 조건으로 다시 보내기' 버튼이 사라짐
 *   큐 적재 전에 죽은 캠페인은 crm_messages 가 0건이라 '실패 건 재발송' 도 안 먹는다.
 *   즉 두 필드 누락 때문에 **복구 경로가 통째로 막혔다**.
 *
 * 이 파일은 매퍼가 그 두 컬럼을 실제로 실어 나르는지만 좁게 고정한다.
 */

const CAMPAIGN_ID = "e9b0e797-b398-46ef-a8db-091f3c959298";

const h = vi.hoisted(() => ({
  row: {
    id: "e9b0e797-b398-46ef-a8db-091f3c959298",
    title: "■ 남궁원T 중대부고1 통합과학",
    template_id: null,
    group_id: null,
    scheduled_at: null,
    sent_at: "2026-08-20T06:17:04.715+00:00",
    status: "실패",
    total_recipients: 155,
    total_cost: 0,
    created_by: null,
    branch: "대치",
    is_test: false,
    body: "본문",
    subject: "제목",
    type: "LMS",
    is_ad: true,
    dedupe_by_phone: true,
    send_to_parent: true,
    send_to_student: false,
    created_at: "2026-08-20T06:17:04.764525+00:00",
    updated_at: "2026-08-20T06:40:32.06554+00:00",
    failed_reason:
      "메시지 큐 적재 실패: canceling statement due to statement timeout",
    send_filters: { kind: "filter", grades: ["고1"], schools: ["중대부고"] },
    sender_division: "수학관",
  } as Record<string, unknown>,
}));

vi.mock("@/lib/profile/students-dev-seed", () => ({
  isDevSeedMode: () => false,
  findDevCampaignById: vi.fn(),
  listDevCampaigns: vi.fn(() => []),
}));

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(async () => ({
    user_id: "u1",
    role: "master" as const,
    branch: "대치",
    active: true,
  })),
}));

// crm_campaigns 는 행을 돌려주고, 조인용 조회(users_profile/templates/groups)는
// 이 캠페인이 template_id·group_id·created_by 가 모두 null 이라 호출되지 않는다.
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _val: string) {
              return {
                maybeSingle: async () => ({ data: h.row, error: null }),
              };
            },
          };
        },
      };
    },
  })),
  createSupabaseServiceClient: vi.fn(),
}));

async function loadGetCampaign() {
  const mod = await import("@/lib/campaigns/get-campaign");
  return mod.getCampaign;
}

describe("getCampaign · 상세 화면 컬럼 패스스루", () => {
  it("failed_reason 을 그대로 실어 나른다 (폴백 문구로 떨어지지 않게)", async () => {
    const getCampaign = await loadGetCampaign();
    const c = await getCampaign(CAMPAIGN_ID);
    expect(c?.failed_reason).toBe(
      "메시지 큐 적재 실패: canceling statement due to statement timeout",
    );
  });

  it("send_filters 를 그대로 실어 나른다 ('같은 조건으로 다시 보내기' 노출 조건)", async () => {
    const getCampaign = await loadGetCampaign();
    const c = await getCampaign(CAMPAIGN_ID);
    // 상세 화면의 판정식과 동일: send_filters != null 이어야 버튼이 뜬다.
    expect(c?.send_filters).not.toBeNull();
    expect(c?.send_filters).toEqual({
      kind: "filter",
      grades: ["고1"],
      schools: ["중대부고"],
    });
  });

  it("sender_division 을 그대로 실어 나른다 (재발송 발신번호 해석용)", async () => {
    // resend-campaign-same-filters 가 getCampaign 결과의 이 값으로 발신번호·
    // 브랜드명을 다시 해석한다. 빠지면 수학관 캠페인이 조용히 본원 번호로 나간다.
    const getCampaign = await loadGetCampaign();
    const c = await getCampaign(CAMPAIGN_ID);
    expect(c?.sender_division).toBe("수학관");
  });

  it("컬럼이 NULL 이면 null 로 내려온다 (undefined 아님)", async () => {
    const prevReason = h.row.failed_reason;
    const prevFilters = h.row.send_filters;
    const prevDivision = h.row.sender_division;
    h.row.failed_reason = null;
    h.row.send_filters = null;
    h.row.sender_division = null;
    try {
      const getCampaign = await loadGetCampaign();
      const c = await getCampaign(CAMPAIGN_ID);
      expect(c?.failed_reason).toBeNull();
      expect(c?.send_filters).toBeNull();
      expect(c?.sender_division).toBeNull();
    } finally {
      h.row.failed_reason = prevReason;
      h.row.send_filters = prevFilters;
      h.row.sender_division = prevDivision;
    }
  });
});
