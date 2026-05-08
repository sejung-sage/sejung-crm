import { describe, it, expect, afterEach, vi } from "vitest";
import { createSmsAdapter } from "@/lib/messaging/adapters";

/**
 * F3-A · SMS 어댑터 팩토리 + sendon mock 모드.
 *
 * 구현 규약 (현행, sendon 단일 벤더):
 *   - SMS_PROVIDER 값 무관 → 항상 sendon 어댑터 (코드 정리로 다른 벤더 모두 제거).
 *   - SMS_ADAPTER_MODE 기본 'mock'. live 는 Part B 수령 후 구현.
 *   - sendon mock cost: SMS=7.4 / LMS=24 / ALIMTALK=6.4 (세정학원 전용 단가).
 *     vendorMessageId 'mock-sendon-' 접두사 + UUID.
 *   - live 모드는 throw 하지 않고 graceful failed 반환 (Part B 미구현 안내).
 *   - 응답·로그에 API Key 노출 금지 (CLAUDE.md #9).
 *
 * 운영 미사용 어댑터(솔라피/문자나라/SK to-go/Sendwise)는 2026-05-08 일괄 제거.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createSmsAdapter · 팩토리 분기", () => {
  it("SMS_PROVIDER 미설정 → name='sendon'", () => {
    vi.stubEnv("SMS_PROVIDER", "");
    vi.stubEnv("SMS_ADAPTER_MODE", "mock");
    const a = createSmsAdapter();
    expect(a.name).toBe("sendon");
  });

  it("SMS_PROVIDER='sendon' → name='sendon'", () => {
    vi.stubEnv("SMS_PROVIDER", "sendon");
    vi.stubEnv("SMS_ADAPTER_MODE", "mock");
    const a = createSmsAdapter();
    expect(a.name).toBe("sendon");
  });

  it("이미 제거된 벤더 이름이 들어와도 sendon 폴백", () => {
    for (const removed of ["solapi", "munjanara", "sk-togo", "sendwise"]) {
      vi.stubEnv("SMS_PROVIDER", removed);
      const a = createSmsAdapter();
      expect(a.name).toBe("sendon");
    }
  });

  it("대문자 섞인 입력에도 sendon", () => {
    vi.stubEnv("SMS_PROVIDER", "SeNdOn");
    const a = createSmsAdapter();
    expect(a.name).toBe("sendon");
  });
});

describe("sendon mock 모드 · send()", () => {
  it("SMS → status='queued', cost=7.4, vendorMessageId 'mock-sendon-' 접두사", async () => {
    vi.stubEnv("SMS_ADAPTER_MODE", "mock");
    const a = createSmsAdapter();
    const out = await a.send({
      to: "01012345678",
      body: "test",
      subject: null,
      type: "SMS",
      fromNumber: "01099999999",
    });
    if (out.status !== "queued") {
      throw new Error(`expected queued, got ${out.status}`);
    }
    expect(out.cost).toBe(7.4);
    expect(out.vendorMessageId.startsWith("mock-sendon-")).toBe(true);
  });

  it("LMS → cost=24", async () => {
    vi.stubEnv("SMS_ADAPTER_MODE", "mock");
    const a = createSmsAdapter();
    const out = await a.send({
      to: "01012345678",
      body: "긴 본문",
      subject: "제목",
      type: "LMS",
      fromNumber: "01099999999",
    });
    if (out.status !== "queued") throw new Error("not queued");
    expect(out.cost).toBe(24);
  });

  it("ALIMTALK → cost=6.4", async () => {
    vi.stubEnv("SMS_ADAPTER_MODE", "mock");
    const a = createSmsAdapter();
    const out = await a.send({
      to: "01012345678",
      body: "알림",
      subject: "알림톡",
      type: "ALIMTALK",
      fromNumber: "01099999999",
    });
    if (out.status !== "queued") throw new Error("not queued");
    expect(out.cost).toBe(6.4);
  });

  it("vendorMessageId 매 호출마다 다름(UUID 기반)", async () => {
    vi.stubEnv("SMS_ADAPTER_MODE", "mock");
    const a = createSmsAdapter();
    const req = {
      to: "01012345678",
      body: "test",
      subject: null,
      type: "SMS" as const,
      fromNumber: "01099999999",
    };
    const out1 = await a.send(req);
    const out2 = await a.send(req);
    if (out1.status !== "queued" || out2.status !== "queued") {
      throw new Error("not queued");
    }
    expect(out1.vendorMessageId).not.toBe(out2.vendorMessageId);
  });

  it("queryStatus(mock) → 'delivered' + ISO deliveredAt", async () => {
    vi.stubEnv("SMS_ADAPTER_MODE", "mock");
    const a = createSmsAdapter();
    const r = await a.queryStatus("any-id");
    expect(r.status).toBe("delivered");
    expect(r.deliveredAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/,
    );
  });
});

describe("sendon live 모드 · 가드 + 시크릿 미노출", () => {
  it("USER ID 없으면 failed", async () => {
    vi.stubEnv("SMS_ADAPTER_MODE", "live");
    vi.stubEnv("SENDON_USER_ID", "");
    vi.stubEnv("SENDON_API_KEY", "key");
    vi.stubEnv("SENDON_FROM_NUMBER", "01099999999");
    const a = createSmsAdapter();
    const r = await a.send({
      to: "01012345678",
      body: "test",
      subject: null,
      type: "SMS",
      fromNumber: "01099999999",
    });
    expect(r.status).toBe("failed");
    if (r.status === "failed") {
      expect(r.reason).toContain("USER ID");
    }
  });

  it("API KEY 없으면 failed", async () => {
    vi.stubEnv("SMS_ADAPTER_MODE", "live");
    vi.stubEnv("SENDON_USER_ID", "user");
    vi.stubEnv("SENDON_API_KEY", "");
    vi.stubEnv("SENDON_FROM_NUMBER", "01099999999");
    const a = createSmsAdapter();
    const r = await a.send({
      to: "01012345678",
      body: "test",
      subject: null,
      type: "SMS",
      fromNumber: "01099999999",
    });
    expect(r.status).toBe("failed");
    if (r.status === "failed") {
      expect(r.reason).toContain("API KEY");
    }
  });

  it("발신번호 누락 시 failed", async () => {
    vi.stubEnv("SMS_ADAPTER_MODE", "live");
    vi.stubEnv("SENDON_USER_ID", "user");
    vi.stubEnv("SENDON_API_KEY", "key");
    vi.stubEnv("SENDON_FROM_NUMBER", "");
    const a = createSmsAdapter();
    const r = await a.send({
      to: "01012345678",
      body: "test",
      subject: null,
      type: "SMS",
      fromNumber: "01099999999",
    });
    expect(r.status).toBe("failed");
    if (r.status === "failed") {
      expect(r.reason).toContain("발신번호");
    }
  });

  it("ALIMTALK live → 템플릿 ID 안내 failed (Phase 1 미구현)", async () => {
    vi.stubEnv("SMS_ADAPTER_MODE", "live");
    vi.stubEnv("SENDON_USER_ID", "user");
    vi.stubEnv("SENDON_API_KEY", "key");
    vi.stubEnv("SENDON_FROM_NUMBER", "01099999999");
    const a = createSmsAdapter();
    const r = await a.send({
      to: "01012345678",
      body: "알림",
      subject: "알림톡",
      type: "ALIMTALK",
      fromNumber: "01099999999",
    });
    expect(r.status).toBe("failed");
    if (r.status === "failed") {
      expect(r.reason).toContain("템플릿");
    }
  });

  it("실 호출은 throw 하지 않고 결과 반환 + 시크릿 미노출", async () => {
    const SECRET = "SENDON_SUPER_SECRET_TOKEN_12345";
    vi.stubEnv("SMS_ADAPTER_MODE", "live");
    vi.stubEnv("SENDON_USER_ID", "fake-user-id");
    vi.stubEnv("SENDON_API_KEY", SECRET);
    vi.stubEnv("SENDON_FROM_NUMBER", "01099999999");
    const a = createSmsAdapter();
    // SDK 가 실제 sendon 서버에 호출할 가능성 — 가짜 KEY 로 실패가 정상.
    // throw 안 하고 SmsSendResult 형태(`failed` / `queued`) 로 반환되어야 한다.
    const r = await a.send({
      to: "01012345678",
      body: "test",
      subject: null,
      type: "SMS",
      fromNumber: "01099999999",
    });
    expect(["queued", "failed"]).toContain(r.status);
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain(SECRET);
  });
});
