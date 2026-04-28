import { describe, it, expect, beforeEach } from "vitest";
import { CampaignListQuerySchema } from "@/lib/schemas/campaign";
import { listCampaigns } from "@/lib/campaigns/list-campaigns";
import { getCampaign } from "@/lib/campaigns/get-campaign";
import { listCampaignMessages } from "@/lib/campaigns/list-campaign-messages";
import {
  DEV_CAMPAIGNS,
  DEV_CAMPAIGN_MESSAGES,
} from "@/lib/profile/students-dev-seed";

/**
 * F3-A · 캠페인 스키마 + dev-seed 리스팅 테스트.
 *
 * 모든 캠페인 조회 함수는 dev-seed 모드에서는 Supabase 접근 없이
 * students-dev-seed 의 헬퍼만 호출한다.
 */

describe("CampaignListQuerySchema · 날짜 형식", () => {
  it("YYYY-MM-DD 정상", () => {
    const r = CampaignListQuerySchema.parse({
      from: "2026-04-01",
      to: "2026-04-30",
    });
    expect(r.from).toBe("2026-04-01");
    expect(r.to).toBe("2026-04-30");
  });

  it("'2026-4-1' (한자리) → 실패", () => {
    const r = CampaignListQuerySchema.safeParse({ from: "2026-4-1" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toContain("YYYY-MM-DD");
    }
  });

  it("알 수 없는 status → 실패", () => {
    const r = CampaignListQuerySchema.safeParse({ status: "보냄" });
    expect(r.success).toBe(false);
  });

  it("정상 status='완료' 파싱", () => {
    const r = CampaignListQuerySchema.parse({ status: "완료" });
    expect(r.status).toBe("완료");
  });

  it("q 빈값 + page 기본 1", () => {
    const r = CampaignListQuerySchema.parse({});
    expect(r.q).toBe("");
    expect(r.page).toBe(1);
  });
});

describe("listCampaigns · dev-seed", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("필터 없음 → 6건 전부", async () => {
    const r = await listCampaigns({ q: "", page: 1 });
    expect(r.total).toBe(DEV_CAMPAIGNS.length);
    expect(r.items).toHaveLength(DEV_CAMPAIGNS.length);
  });

  it("status='완료' → 완료 캠페인만", async () => {
    const r = await listCampaigns({ q: "", page: 1, status: "완료" });
    expect(r.items.every((c) => c.status === "완료")).toBe(true);
    expect(r.total).toBeGreaterThan(0);
  });

  it("status='실패' → 실패 캠페인만", async () => {
    const r = await listCampaigns({ q: "", page: 1, status: "실패" });
    expect(r.items.every((c) => c.status === "실패")).toBe(true);
  });

  it("q='개강' → 제목 매칭", async () => {
    const r = await listCampaigns({ q: "개강", page: 1 });
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.every((c) => c.title.includes("개강"))).toBe(true);
  });

  it("조인·집계 필드(template_name, group_name, delivered_count, failed_count) 존재", async () => {
    const r = await listCampaigns({ q: "", page: 1 });
    for (const c of r.items) {
      expect(c).toHaveProperty("template_name");
      expect(c).toHaveProperty("group_name");
      expect(c).toHaveProperty("delivered_count");
      expect(c).toHaveProperty("failed_count");
    }
  });

  it("from/to 범위 필터 동작 · 2026-04-15~04-22", async () => {
    const r = await listCampaigns({
      q: "",
      page: 1,
      from: "2026-04-15",
      to: "2026-04-22",
    });
    // cmp-3(04-15), cmp-4(04-20), cmp-6(04-18) 이 들어와야 함. cmp-5(04-25) 제외.
    expect(r.items.length).toBeGreaterThan(0);
    for (const c of r.items) {
      const ref = c.sent_at ?? c.scheduled_at;
      expect(ref).toBeTruthy();
      if (ref) {
        expect(ref.slice(0, 10) >= "2026-04-15").toBe(true);
        expect(ref.slice(0, 10) <= "2026-04-22").toBe(true);
      }
    }
  });
});

describe("getCampaign · dev-seed", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("존재하는 id → 해당 캠페인 반환 + 조인 필드 포함", async () => {
    const id = DEV_CAMPAIGNS[0].id;
    const r = await getCampaign(id);
    expect(r).not.toBeNull();
    expect(r?.id).toBe(id);
    expect(r?.title).toBe(DEV_CAMPAIGNS[0].title);
    // 조인 필드 존재
    expect(r).toHaveProperty("template_name");
    expect(r).toHaveProperty("delivered_count");
  });

  it("없는 id → null", async () => {
    const r = await getCampaign("dev-cmp-not-exist");
    expect(r).toBeNull();
  });

  it("빈 id → null (guard)", async () => {
    const r = await getCampaign("");
    expect(r).toBeNull();
  });
});

describe("listCampaignMessages · dev-seed", () => {
  beforeEach(() => {
    process.env.SEJUNG_DEV_SEED = "1";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("dev-cmp-1 → 해당 캠페인 메시지만 반환", async () => {
    const messages = await listCampaignMessages("dev-cmp-1");
    const expected = DEV_CAMPAIGN_MESSAGES.filter(
      (m) => m.campaign_id === "dev-cmp-1",
    );
    expect(messages).toHaveLength(expected.length);
    expect(messages.every((m) => m.campaign_id === "dev-cmp-1")).toBe(true);
  });

  it("각 메시지에 student_name 조인 필드 존재", async () => {
    const messages = await listCampaignMessages("dev-cmp-1");
    expect(messages.length).toBeGreaterThan(0);
    for (const m of messages) {
      expect(m).toHaveProperty("student_name");
      // DC0001/DC0002 는 프로필 매칭되므로 문자열이어야 함
      expect(typeof m.student_name === "string" || m.student_name === null).toBe(
        true,
      );
    }
  });

  it("빈 campaignId → 빈 배열", async () => {
    const messages = await listCampaignMessages("");
    expect(messages).toEqual([]);
  });

  it("없는 campaignId → 빈 배열", async () => {
    const messages = await listCampaignMessages("dev-cmp-not-exist");
    expect(messages).toEqual([]);
  });
});
