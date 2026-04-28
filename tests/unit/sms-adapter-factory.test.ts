import { describe, it, expect, afterEach, vi } from "vitest";
import { createSmsAdapter } from "@/lib/messaging/adapters";

/**
 * F3-A · SMS 어댑터 팩토리 + 솔라피/문자나라 mock 모드.
 *
 * 구현 규약 (현행, 솔라피 1순위):
 *   - SMS_PROVIDER 기본 'solapi'. 알 수 없는 값은 'solapi' 로 안전 폴백.
 *   - SMS_ADAPTER_MODE 기본 'mock'. live 호출은 Part B 전까지 throw.
 *   - 'sk-togo' / 'sendwise' 는 Phase 1 스텁. send()/queryStatus() 즉시 throw.
 *   - 'munjanara' 어댑터는 백업으로 유지 (회귀 방지). mock cost: SMS=20, LMS=25, ALIMTALK=15.
 *   - 'solapi' mock cost: SMS=8, LMS=14, ALIMTALK=13. vendorMessageId 는 'mock-solapi-' 접두사.
 *   - live 모드 에러 메시지에 API Key/Secret 노출 금지 (CLAUDE.md #9).
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

  it("SMS_PROVIDER='munjanara' → name='munjanara' (백업 어댑터 회귀 유지)", () => {
    vi.stubEnv("SMS_PROVIDER", "munjanara");
    vi.stubEnv("SMS_ADAPTER_MODE", "mock");
    const a = createSmsAdapter();
    expect(a.name).toBe("munjanara");
  });

  it("SMS_PROVIDER='sk-togo' → name='sk-togo'", () => {
    vi.stubEnv("SMS_PROVIDER", "sk-togo");
    vi.stubEnv("SMS_ADAPTER_MODE", "mock");
    const a = createSmsAdapter();
    expect(a.name).toBe("sk-togo");
  });

  it("SMS_PROVIDER='sendwise' → name='sendwise'", () => {
    vi.stubEnv("SMS_PROVIDER", "sendwise");
    vi.stubEnv("SMS_ADAPTER_MODE", "mock");
    const a = createSmsAdapter();
    expect(a.name).toBe("sendwise");
  });

  it("알 수 없는 SMS_PROVIDER='foo' → solapi 폴백", () => {
    vi.stubEnv("SMS_PROVIDER", "foo");
    vi.stubEnv("SMS_ADAPTER_MODE", "mock");
    const a = createSmsAdapter();
    expect(a.name).toBe("solapi");
  });

  it("대문자 섞인 입력도 소문자 정규화 (solapi)", () => {
    vi.stubEnv("SMS_PROVIDER", "SoLaPi");
    const a = createSmsAdapter();
    expect(a.name).toBe("solapi");
  });

  it("대문자 섞인 입력도 소문자 정규화 (munjanara)", () => {
    vi.stubEnv("SMS_PROVIDER", "MunJaNaRa");
    const a = createSmsAdapter();
    expect(a.name).toBe("munjanara");
  });
});

describe("createSmsAdapter · 스텁 벤더는 호출 시 throw", () => {
  it("sk-togo.send() → throw (Phase 1)", async () => {
    vi.stubEnv("SMS_PROVIDER", "sk-togo");
    const a = createSmsAdapter();
    await expect(
      a.send({
        to: "01012345678",
        body: "test",
        subject: null,
        type: "SMS",
        fromNumber: "0212345678",
      }),
    ).rejects.toThrow(/Phase 1/);
  });

  it("sk-togo.queryStatus() → throw", async () => {
    vi.stubEnv("SMS_PROVIDER", "sk-togo");
    const a = createSmsAdapter();
    await expect(a.queryStatus("id")).rejects.toThrow(/Phase 1/);
  });

  it("sendwise.send() → throw (Phase 1)", async () => {
    vi.stubEnv("SMS_PROVIDER", "sendwise");
    const a = createSmsAdapter();
    await expect(
      a.send({
        to: "01012345678",
        body: "test",
        subject: null,
        type: "SMS",
        fromNumber: "0212345678",
      }),
    ).rejects.toThrow(/Phase 1/);
  });
});

describe("munjanara mock 모드 · send() (백업 어댑터 회귀)", () => {
  it("SMS → status='queued', cost=20, vendorMessageId 문자열", async () => {
    vi.stubEnv("SMS_PROVIDER", "munjanara");
    vi.stubEnv("SMS_ADAPTER_MODE", "mock");
    const a = createSmsAdapter();
    const out = await a.send({
      to: "01012345678",
      body: "test",
      subject: null,
      type: "SMS",
      fromNumber: "0212345678",
    });
    if (out.status !== "queued") {
      throw new Error(`expected queued, got ${out.status}`);
    }
    expect(out.status).toBe("queued");
    expect(out.cost).toBe(20);
    expect(typeof out.vendorMessageId).toBe("string");
    expect(out.vendorMessageId.length).toBeGreaterThan(0);
  });

  it("LMS → cost=25", async () => {
    vi.stubEnv("SMS_PROVIDER", "munjanara");
    vi.stubEnv("SMS_ADAPTER_MODE", "mock");
    const a = createSmsAdapter();
    const out = await a.send({
      to: "01012345678",
      body: "body",
      subject: "제목",
      type: "LMS",
      fromNumber: "0212345678",
    });
    if (out.status !== "queued") throw new Error("not queued");
    expect(out.cost).toBe(25);
  });

  it("ALIMTALK → cost=15", async () => {
    vi.stubEnv("SMS_PROVIDER", "munjanara");
    vi.stubEnv("SMS_ADAPTER_MODE", "mock");
    const a = createSmsAdapter();
    const out = await a.send({
      to: "01012345678",
      body: "알림",
      subject: "알림톡",
      type: "ALIMTALK",
      fromNumber: "0212345678",
    });
    if (out.status !== "queued") throw new Error("not queued");
    expect(out.cost).toBe(15);
  });

  it("vendorMessageId 는 매 호출마다 다름(UUID)", async () => {
    vi.stubEnv("SMS_PROVIDER", "munjanara");
    vi.stubEnv("SMS_ADAPTER_MODE", "mock");
    const a = createSmsAdapter();
    const req = {
      to: "01012345678",
      body: "test",
      subject: null,
      type: "SMS" as const,
      fromNumber: "0212345678",
    };
    const out1 = await a.send(req);
    const out2 = await a.send(req);
    if (out1.status !== "queued" || out2.status !== "queued") {
      throw new Error("not queued");
    }
    expect(out1.vendorMessageId).not.toBe(out2.vendorMessageId);
  });

  it("queryStatus(mock) → status='delivered' + deliveredAt 문자열", async () => {
    vi.stubEnv("SMS_PROVIDER", "munjanara");
    vi.stubEnv("SMS_ADAPTER_MODE", "mock");
    const a = createSmsAdapter();
    const r = await a.queryStatus("mock-123");
    expect(r.status).toBe("delivered");
    expect(typeof r.deliveredAt).toBe("string");
  });
});

describe("munjanara live 모드 · Part B 전까지 throw", () => {
  it("live send() → throw (Part B 안내)", async () => {
    vi.stubEnv("SMS_PROVIDER", "munjanara");
    vi.stubEnv("SMS_ADAPTER_MODE", "live");
    const a = createSmsAdapter();
    await expect(
      a.send({
        to: "01012345678",
        body: "test",
        subject: null,
        type: "SMS",
        fromNumber: "0212345678",
      }),
    ).rejects.toThrow(/Part B/);
  });

  it("live queryStatus() → throw", async () => {
    vi.stubEnv("SMS_PROVIDER", "munjanara");
    vi.stubEnv("SMS_ADAPTER_MODE", "live");
    const a = createSmsAdapter();
    await expect(a.queryStatus("mn-abc")).rejects.toThrow(/Part B/);
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
    expect(out.status).toBe("queued");
    expect(out.cost).toBe(8);
    expect(typeof out.vendorMessageId).toBe("string");
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
    expect(out.vendorMessageId.startsWith("mock-solapi-")).toBe(true);
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

  it("queryStatus(mock) → status='delivered' + deliveredAt ISO 문자열", async () => {
    vi.stubEnv("SMS_PROVIDER", "solapi");
    vi.stubEnv("SMS_ADAPTER_MODE", "mock");
    const a = createSmsAdapter();
    const r = await a.queryStatus("any-id");
    expect(r.status).toBe("delivered");
    expect(typeof r.deliveredAt).toBe("string");
    // ISO 8601 형태 (e.g. 2026-04-22T12:34:56.789Z) 검증
    expect(r.deliveredAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/,
    );
    // 실제로 파싱 가능한 날짜인지
    expect(Number.isNaN(Date.parse(r.deliveredAt as string))).toBe(false);
  });
});

describe("solapi live 모드 · 실 호출 결과 + 시크릿 미노출", () => {
  // 솔라피 SDK 가 실제로 호출되지만 테스트 환경에선 네트워크 도달 불가 또는
  // 잘못된 키로 실패함. 어댑터는 throw 대신 SmsSendResult 형태 ('failed') 반환.
  // 핵심 회귀 방어는 응답 reason 에 KEY/SECRET 가 누설되지 않는지.

  it("live send() → throw 하지 않고 failed 반환 (네트워크/인증 실패 시 graceful)", async () => {
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
    // 실 호출이 성공할 가능성은 거의 없지만(가짜 키), 두 케이스 모두 허용.
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

  it("live queryStatus() → throw 하지 않고 결과 반환 + 시크릿 미노출", async () => {
    const SECRET_KEY = "NCSAAAAAAAAA_SUPER_SECRET_KEY";
    const SECRET_VALUE = "BBBBBBBB_TOP_SECRET_VALUE";
    vi.stubEnv("SMS_PROVIDER", "solapi");
    vi.stubEnv("SMS_ADAPTER_MODE", "live");
    vi.stubEnv("SOLAPI_API_KEY", SECRET_KEY);
    vi.stubEnv("SOLAPI_API_SECRET", SECRET_VALUE);
    const a = createSmsAdapter();
    const result = await a.queryStatus("solapi-some-id");
    // status 는 어떤 값이든 허용. 핵심은 throw 안 하고 시크릿 미노출.
    expect(result).toBeDefined();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(SECRET_KEY);
    expect(serialized).not.toContain(SECRET_VALUE);
  });
});
