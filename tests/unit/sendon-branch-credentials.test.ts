import { describe, it, expect, afterEach, vi } from "vitest";
import {
  sendonFromNumber,
  sendonUserId,
  sendonApiKey,
} from "@/config/sender-numbers";

/**
 * 분원별 sendon 계정·발신번호 해석 (2026-06-24).
 *
 * 분원마다 sendon 계정(충전·발신번호)이 다른 운영 지원. 핵심 회귀 보호:
 *   - 분원 전용 env 가 있으면 그 값.
 *   - 없으면 기본 키(SENDON_USER_ID / SENDON_API_KEY / SENDON_FROM_NUMBER) 폴백
 *     → 분원 키 미설정 시 기존 단일 계정과 100% 동일(회귀 없음).
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sendonUserId / sendonApiKey · 분원별 계정", () => {
  it("분원 전용 키가 있으면 그 값", () => {
    vi.stubEnv("SENDON_USER_ID", "base-user");
    vi.stubEnv("SENDON_API_KEY", "base-key");
    vi.stubEnv("SENDON_USER_ID_BANPO", "banpo-user");
    vi.stubEnv("SENDON_API_KEY_BANPO", "banpo-key");
    expect(sendonUserId("반포")).toBe("banpo-user");
    expect(sendonApiKey("반포")).toBe("banpo-key");
  });

  it("분원 전용 키가 없으면 기본 키로 폴백(회귀 없음)", () => {
    vi.stubEnv("SENDON_USER_ID", "base-user");
    vi.stubEnv("SENDON_API_KEY", "base-key");
    vi.stubEnv("SENDON_USER_ID_SONGDO", "");
    vi.stubEnv("SENDON_API_KEY_SONGDO", "");
    expect(sendonUserId("송도")).toBe("base-user");
    expect(sendonApiKey("송도")).toBe("base-key");
  });

  it("branch 미지정(전체/마스터) → 기본 키", () => {
    vi.stubEnv("SENDON_USER_ID", "base-user");
    vi.stubEnv("SENDON_API_KEY", "base-key");
    expect(sendonUserId(null)).toBe("base-user");
    expect(sendonUserId(undefined)).toBe("base-user");
    expect(sendonApiKey(null)).toBe("base-key");
  });

  it("알 수 없는 분원 → 기본 키 폴백", () => {
    vi.stubEnv("SENDON_USER_ID", "base-user");
    vi.stubEnv("SENDON_API_KEY", "base-key");
    expect(sendonUserId("없는분원")).toBe("base-user");
    expect(sendonApiKey("없는분원")).toBe("base-key");
  });

  it("기본 키도 없으면 undefined", () => {
    vi.stubEnv("SENDON_USER_ID", "");
    vi.stubEnv("SENDON_API_KEY", "");
    expect(sendonUserId("대치")).toBeUndefined();
    expect(sendonApiKey("대치")).toBeUndefined();
  });
});

describe("sendonFromNumber · 분원별 발신번호 (계정과 동일 폴백)", () => {
  it("분원 전용 번호가 있으면 그 값(숫자만)", () => {
    vi.stubEnv("SENDON_FROM_NUMBER", "0212340000");
    vi.stubEnv("SENDON_FROM_NUMBER_DAECHI", "02-567-0606");
    expect(sendonFromNumber("대치")).toBe("025670606");
  });

  it("분원 전용 번호 없으면 기본 번호 폴백", () => {
    vi.stubEnv("SENDON_FROM_NUMBER", "0212340000");
    vi.stubEnv("SENDON_FROM_NUMBER_BANPO", "");
    expect(sendonFromNumber("반포")).toBe("0212340000");
  });
});
