import { describe, it, expect, afterEach, vi } from "vitest";
import { createSmsAdapter } from "@/lib/messaging/adapters";

/**
 * F3-A · SMS 어댑터 팩토리 + solapi/sendon mock 모드.
 *
 * 구현 규약 (현행):
 *   - SMS_PROVIDER 기본 'solapi'. 알 수 없는 값은 'solapi' 로 안전 폴백.
 *   - SMS_ADAPTER_MODE 기본 'mock'. live 호출은 어댑터별 정책에 따라 동작.
 *   - 'solapi' mock cost: SMS=8 / LMS=14 / ALIMTALK=13. vendorMessageId 'mock-solapi-' 접두사.
 *   - 'sendon'  mock cost: SMS=8 / LMS=14 / ALIMTALK=13. vendorMessageId 'mock-sendon-' 접두사.
 *     live 모드는 Part B 대기 — failed 반환 (throw 하지 않음).
 *   - live 모드 에러 메시지에 API Key/Secret 노출 금지 (CLAUDE.md #9).
 *
 * 운영 미사용 백업 어댑터(문자나라/SK to-go/Sendwise)는 2026-05-08 제거됨.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createSmsAdapter · 팩토리 분기", () => {
  it("SMS_PROVIDER 미설정 → name='solapi' (1순위 기본값)", () => {
    vi.stubEnv("SMS_PROVIDER", "");
    vi.stubEnv("SMS_ADAPTER_MODE", "mock");
    const a = createSmsAdapter();
    expect(a.name).toBe("solapi");
  });

  it("SMS_PROVIDER='solapi' → name='solapi'", () => {
    vi.stubEnv("SMS_PROVIDER", "solapi");
    vi.stubEnv("SMS_ADAPTER_MODE", "mock");
    const a = createSmsAdapter();
    expect(a.name).toBe("solapi");
  });

  it("SMS_PROVIDER='sendon' → name='sendon'", () => {
    vi.stubEnv("SMS_PROVIDER", "sendon");
    vi.stubEnv("SMS_ADAPTER_MODE", "mock");
    const a = createSmsAdapter();
    expect(a.name).toBe("sendon");
  });

  it("알 수 없는 SMS_PROVIDER='foo' → solapi 폴백", () => {
    vi.stubEnv("SMS_PROVIDER", "foo");
    vi.stubEnv("SMS_ADAPTER_MODE", "mock");
    const a = createSmsAdapter();
    expect(a.name).toBe("solapi");
  });

  it("이미 제거된 백업 어댑터 이름은 solapi 폴백", () => {
    for (const removed of ["munjanara", "sk-togo", "sendwise"]) {
      vi.stubEnv("SMS_PROVIDER", removed);
      const a = createSmsAdapter();
      expect(a.name).toBe("solapi");
    }
  });

  it("대문자 섞인 입력도 소문자 정규화 (solapi)", () => {
    vi.stubEnv("SMS_PROVIDER", "SoLaPi");
    const a = createSmsAdapter();
    expect(a.name).toBe("solapi");
  });

  it("대문자 섞인 입력도 소문자 정규화 (sendon)", () => {
    vi.stubEnv("SMS_PROVIDER", "SeNdOn");
    const a = createSmsAdapter();
    expect(a.name).toBe("sendon");
  });
});

describe("solapi mock 모드 · send() (1순위 실구현 대상)", () => {
  it("SMS → status='queued', cost=8, vendorMessageId 'mock-solapi-' 접두사", async () => {
    vi.stubEnv("SMS_PROVIDER", "solapi");
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
    expect(out.cost).toBe(8);
    expect(out.vendorMessageId.startsWith("mock-solapi-")).toBe(true);
  });

  it("LMS → cost=14", async () => {
    vi.stubEnv("SMS_PROVIDER", "solapi");
    vi.stubEnv("SMS_ADAPTER_MODE", "mock");
    const a = createSmsAdapter();
    const out = await a.send({
      to: "01012345678",
      body: "본문이 좀 더 긴 LMS 메시지",
      subject: "제목",
      type: "LMS",
      fromNumber: "01099999999",
    });
    if (out.status !== "queued") throw new Error("not queued");
    expect(out.cost).toBe(14);
    expect(out.vendorMessageId.startsWith("mock-solapi-")).toBe(true);
  });

  it("ALIMTALK → cost=13", async () => {
    vi.stubEnv("SMS_PROVIDER", "solapi");
    vi.stubEnv("SMS_ADAPTER_MODE", "mock");
    const a = createSmsAdapter();
    const out = await a.send({
      to: "01012345678",
      body: "알림톡 본문",
      subject: "알림톡",
      type: "ALIMTALK",
      fromNumber: "01099999999",
    });
    if (out.status !== "queued") throw new Error("not queued");
    expect(out.cost).toBe(13);
  });

  it("vendorMessageId 는 매 호출마다 다름(UUID 기반)", async () => {
    vi.stubEnv("SMS_PROVIDER", "solapi");
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

  it("queryStatus(mock) → status='delivered' + ISO deliveredAt", async () => {
    vi.stubEnv("SMS_PROVIDER", "solapi");
    vi.stubEnv("SMS_ADAPTER_MODE", "mock");
    const a = createSmsAdapter();
    const r = await a.queryStatus("any-id");
    expect(r.status).toBe("delivered");
    expect(r.deliveredAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/,
    );
  });
});

describe("sendon mock 모드 · send()", () => {
  it("SMS → cost=8, vendorMessageId 'mock-sendon-' 접두사", async () => {
    vi.stubEnv("SMS_PROVIDER", "sendon");
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
    expect(out.cost).toBe(8);
    expect(out.vendorMessageId.startsWith("mock-sendon-")).toBe(true);
  });

  it("LMS → cost=14", async () => {
    vi.stubEnv("SMS_PROVIDER", "sendon");
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
    expect(out.cost).toBe(14);
  });

  it("ALIMTALK → cost=13", async () => {
    vi.stubEnv("SMS_PROVIDER", "sendon");
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
    expect(out.cost).toBe(13);
  });

  it("queryStatus(mock) → 'delivered'", async () => {
    vi.stubEnv("SMS_PROVIDER", "sendon");
    vi.stubEnv("SMS_ADAPTER_MODE", "mock");
    const a = createSmsAdapter();
    const r = await a.queryStatus("mock-sendon-x");
    expect(r.status).toBe("delivered");
  });
});

describe("sendon live 모드 · Part B 전까지 graceful failed", () => {
  it("API KEY 없으면 failed (KEY 누설 X)", async () => {
    vi.stubEnv("SMS_PROVIDER", "sendon");
    vi.stubEnv("SMS_ADAPTER_MODE", "live");
    vi.stubEnv("SENDON_API_KEY", "");
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

  it("KEY/발신번호 충족 시에도 Part B 미구현 안내 failed (Throw X · 시크릿 미노출)", async () => {
    const SECRET = "SENDON_SUPER_SECRET_TOKEN_12345";
    vi.stubEnv("SMS_PROVIDER", "sendon");
    vi.stubEnv("SMS_ADAPTER_MODE", "live");
    vi.stubEnv("SENDON_API_KEY", SECRET);
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
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain(SECRET);
  });

  it("ALIMTALK 은 Part B 안내 failed", async () => {
    vi.stubEnv("SMS_PROVIDER", "sendon");
    vi.stubEnv("SMS_ADAPTER_MODE", "live");
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
});

describe("solapi live 모드 · 실 호출 결과 + 시크릿 미노출", () => {
  it("live send() → throw 하지 않고 failed/queued 반환", async () => {
    vi.stubEnv("SMS_PROVIDER", "solapi");
    vi.stubEnv("SMS_ADAPTER_MODE", "live");
    vi.stubEnv("SOLAPI_API_KEY", "NCSAAAAAAAAA_SUPER_SECRET_KEY");
    vi.stubEnv("SOLAPI_API_SECRET", "BBBBBBBB_TOP_SECRET_VALUE");
    vi.stubEnv("SOLAPI_FROM_NUMBER", "01099999999");
    const a = createSmsAdapter();
    const result = await a.send({
      to: "01012345678",
      body: "test",
      subject: null,
      type: "SMS",
      fromNumber: "01099999999",
    });
    expect(["queued", "failed"]).toContain(result.status);
  });

  it("live send() 응답에 API Key/Secret 가 노출되지 않음", async () => {
    const SECRET_KEY = "NCSAAAAAAAAA_SUPER_SECRET_KEY";
    const SECRET_VALUE = "BBBBBBBB_TOP_SECRET_VALUE";
    vi.stubEnv("SMS_PROVIDER", "solapi");
    vi.stubEnv("SMS_ADAPTER_MODE", "live");
    vi.stubEnv("SOLAPI_API_KEY", SECRET_KEY);
    vi.stubEnv("SOLAPI_API_SECRET", SECRET_VALUE);
    vi.stubEnv("SOLAPI_FROM_NUMBER", "01099999999");
    const a = createSmsAdapter();
    const result = await a.send({
      to: "01012345678",
      body: "test",
      subject: null,
      type: "SMS",
      fromNumber: "01099999999",
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(SECRET_KEY);
    expect(serialized).not.toContain(SECRET_VALUE);
    expect(serialized).not.toMatch(/NCSA[A-Z0-9]+/);
  });
});
