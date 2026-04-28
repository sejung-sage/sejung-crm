import { describe, it, expect, afterEach } from "vitest";
import { vi } from "vitest";
import { insertUnsubscribeFooter } from "@/lib/messaging/guards/insert-unsubscribe-footer";

/**
 * F3-A · 무료수신거부 footer 자동 삽입 가드.
 *
 * 구현 규약:
 *   - isAd=false → 원문 그대로.
 *   - isAd=true 이고 본문에 "무료수신거부" 문자열이 이미 있으면 추가 안 함.
 *   - 번호 우선순위: 인자 > env(SMS_OPT_OUT_NUMBER) > 기본값("080-123-4567").
 *   - 본문과 footer 사이 `\n` 한 개.
 */

const DEFAULT_FOOTER_NUMBER = "080-123-4567";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("insertUnsubscribeFooter · isAd=false", () => {
  it("광고 아님 → 원문 그대로", () => {
    expect(insertUnsubscribeFooter("안녕하세요", false)).toBe("안녕하세요");
  });
});

describe("insertUnsubscribeFooter · 기본 번호 삽입", () => {
  it("env 없고 인자 없음 → 기본 번호 footer", () => {
    vi.stubEnv("SMS_OPT_OUT_NUMBER", "");
    const out = insertUnsubscribeFooter("본문", true);
    expect(out).toBe(`본문\n무료수신거부 ${DEFAULT_FOOTER_NUMBER}`);
  });

  it("본문과 footer 사이 개행 1개", () => {
    vi.stubEnv("SMS_OPT_OUT_NUMBER", "");
    const out = insertUnsubscribeFooter("본문", true);
    const nlCount = (out.match(/\n/g) ?? []).length;
    expect(nlCount).toBe(1);
  });
});

describe("insertUnsubscribeFooter · 번호 우선순위", () => {
  it("env 설정 시 env 번호 사용", () => {
    vi.stubEnv("SMS_OPT_OUT_NUMBER", "080-999-8888");
    const out = insertUnsubscribeFooter("본문", true);
    expect(out).toBe("본문\n무료수신거부 080-999-8888");
  });

  it("인자 > env · 인자가 우선", () => {
    vi.stubEnv("SMS_OPT_OUT_NUMBER", "080-999-8888");
    const out = insertUnsubscribeFooter("본문", true, "080-111-2222");
    expect(out).toBe("본문\n무료수신거부 080-111-2222");
  });

  it("인자가 공백뿐 → 공백 trim 후 env 폴백", () => {
    vi.stubEnv("SMS_OPT_OUT_NUMBER", "080-999-8888");
    const out = insertUnsubscribeFooter("본문", true, "   ");
    expect(out).toBe("본문\n무료수신거부 080-999-8888");
  });
});

describe("insertUnsubscribeFooter · 중복 삽입 방지", () => {
  it("본문에 '무료수신거부' 포함 → 그대로 반환", () => {
    const body = "공지입니다\n무료수신거부 080-000-1111";
    expect(insertUnsubscribeFooter(body, true)).toBe(body);
  });

  it("본문 어디든 '무료수신거부' 키워드가 있으면 추가 안 함", () => {
    const body = "무료수신거부 안내가 이미 본문에 있음";
    expect(insertUnsubscribeFooter(body, true, "080-111-2222")).toBe(body);
  });
});
