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

  it("방배는 반포 계정 공유 — 방배 계정 키 없어도 반포 계정으로", () => {
    vi.stubEnv("SENDON_USER_ID", "base-user");
    vi.stubEnv("SENDON_API_KEY", "base-key");
    vi.stubEnv("SENDON_USER_ID_BANPO", "banpo-user");
    vi.stubEnv("SENDON_API_KEY_BANPO", "banpo-key");
    // 방배 전용 키는 비움 → 반포 계정으로 폴백(기본 base 가 아니라).
    vi.stubEnv("SENDON_USER_ID_BANGBAE", "");
    vi.stubEnv("SENDON_API_KEY_BANGBAE", "");
    expect(sendonUserId("방배")).toBe("banpo-user");
    expect(sendonApiKey("방배")).toBe("banpo-key");
  });

  it("방배 전용 키가 있으면 그게 우선(나중에 독립 계정)", () => {
    vi.stubEnv("SENDON_USER_ID", "base-user");
    vi.stubEnv("SENDON_USER_ID_BANPO", "banpo-user");
    vi.stubEnv("SENDON_USER_ID_BANGBAE", "bangbae-user");
    expect(sendonUserId("방배")).toBe("bangbae-user");
  });

  it("방배: 반포 계정 키도 없으면 기본 폴백", () => {
    vi.stubEnv("SENDON_USER_ID", "base-user");
    vi.stubEnv("SENDON_USER_ID_BANPO", "");
    vi.stubEnv("SENDON_USER_ID_BANGBAE", "");
    expect(sendonUserId("방배")).toBe("base-user");
  });

  it("방배 발신번호는 전용(반포 공유 아님)", () => {
    vi.stubEnv("SENDON_FROM_NUMBER", "0212340000");
    vi.stubEnv("SENDON_FROM_NUMBER_BANPO", "0262420909");
    vi.stubEnv("SENDON_FROM_NUMBER_BANGBAE", "025326552");
    // 방배 번호는 방배 전용 — 반포 번호로 안 샘.
    expect(sendonFromNumber("방배")).toBe("025326552");
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

describe("sendonFromNumber · 발신 division 축 (대치 본원/수학관)", () => {
  describe("division 전용 번호 해석", () => {
    it("(대치, 수학관) → SENDON_FROM_NUMBER_DAECHI_MATH 값(숫자만)", () => {
      vi.stubEnv("SENDON_FROM_NUMBER", "0212340000");
      vi.stubEnv("SENDON_FROM_NUMBER_DAECHI", "02-567-0606");
      vi.stubEnv("SENDON_FROM_NUMBER_DAECHI_MATH", "02-6265-1010");
      expect(sendonFromNumber("대치", "수학관")).toBe("0262651010");
    });

    it("본원 번호와 수학관 번호는 서로 다른 값으로 해석", () => {
      vi.stubEnv("SENDON_FROM_NUMBER", "0212340000");
      vi.stubEnv("SENDON_FROM_NUMBER_DAECHI", "025670606");
      vi.stubEnv("SENDON_FROM_NUMBER_DAECHI_MATH", "0262651010");
      expect(sendonFromNumber("대치", "수학관")).toBe("0262651010");
      expect(sendonFromNumber("대치", "본원")).toBe("025670606");
      expect(sendonFromNumber("대치", "수학관")).not.toBe(
        sendonFromNumber("대치", "본원"),
      );
    });
  });

  describe("무회귀 · division 본원 == division 생략", () => {
    it("(대치, 본원) 과 (대치) 는 동일한 본원 번호", () => {
      vi.stubEnv("SENDON_FROM_NUMBER", "0212340000");
      vi.stubEnv("SENDON_FROM_NUMBER_DAECHI", "025670606");
      vi.stubEnv("SENDON_FROM_NUMBER_DAECHI_MATH", "0262651010");
      expect(sendonFromNumber("대치", "본원")).toBe("025670606");
      expect(sendonFromNumber("대치")).toBe("025670606");
      expect(sendonFromNumber("대치", "본원")).toBe(sendonFromNumber("대치"));
    });

    it("(대치, null) 도 division 생략과 동일(본원 번호)", () => {
      vi.stubEnv("SENDON_FROM_NUMBER", "0212340000");
      vi.stubEnv("SENDON_FROM_NUMBER_DAECHI", "025670606");
      vi.stubEnv("SENDON_FROM_NUMBER_DAECHI_MATH", "0262651010");
      expect(sendonFromNumber("대치", null)).toBe(sendonFromNumber("대치"));
    });
  });

  describe("폴백 · division 번호 미설정 시 발송이 막히지 않음", () => {
    it("수학관 전용 키가 없으면 대치 본원 번호로 폴백", () => {
      vi.stubEnv("SENDON_FROM_NUMBER", "0212340000");
      vi.stubEnv("SENDON_FROM_NUMBER_DAECHI", "025670606");
      vi.stubEnv("SENDON_FROM_NUMBER_DAECHI_MATH", "");
      expect(sendonFromNumber("대치", "수학관")).toBe("025670606");
    });

    it("수학관·대치 본원 둘 다 없으면 기본 SENDON_FROM_NUMBER 폴백", () => {
      vi.stubEnv("SENDON_FROM_NUMBER", "0212340000");
      vi.stubEnv("SENDON_FROM_NUMBER_DAECHI", "");
      vi.stubEnv("SENDON_FROM_NUMBER_DAECHI_MATH", "");
      expect(sendonFromNumber("대치", "수학관")).toBe("0212340000");
    });

    it("셋 다 비면 null → 호출부가 발송을 거부", () => {
      vi.stubEnv("SENDON_FROM_NUMBER", "");
      vi.stubEnv("SENDON_FROM_NUMBER_DAECHI", "");
      vi.stubEnv("SENDON_FROM_NUMBER_DAECHI_MATH", "");
      expect(sendonFromNumber("대치", "수학관")).toBeNull();
    });
  });
});
