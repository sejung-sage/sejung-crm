import { describe, it, expect } from "vitest";
import {
  findLegacyTokens,
  convertLegacyTokens,
  hasConvertibleLegacyToken,
} from "@/lib/messaging/legacy-tokens";

/**
 * Aca2000 문법(%%학생) 감지·변환.
 *
 * 회귀 기준: 반포 부원장이 제보한 실제 상용문구를 그대로 저장해도
 * `%%학생` 이 발송 본문에 남지 않아야 한다 (2026-08-07).
 */

// 실제 제보 문구 (반포세정 수강신청 안내).
const REAL_BODY = `【반포세정】

%%학생

OOOT OO강좌 수강신청 되었습니다

카톡으로 보내드리는 결제링크 통해 결제 바랍니다

상담문의: 02-6242-0909
문자전용: 010-8942-3488`;

describe("findLegacyTokens", () => {
  it("%%학생 을 찾아낸다", () => {
    expect(findLegacyTokens(REAL_BODY)).toEqual(["%%학생"]);
  });

  it("같은 토큰이 여러 번 나와도 한 번만 반환", () => {
    expect(findLegacyTokens("%%학생 님, %%학생 확인")).toEqual(["%%학생"]);
  });

  it("변환표에 없는 %% 토큰도 수집한다 (경고용)", () => {
    expect(findLegacyTokens("%%학생 %%반이름")).toEqual([
      "%%학생",
      "%%반이름",
    ]);
  });

  it("토큰이 없으면 빈 배열", () => {
    expect(findLegacyTokens("안녕하세요 {이름} 님")).toEqual([]);
  });

  it("우리 토큰 {이름} 은 잡지 않는다", () => {
    expect(findLegacyTokens("{이름} {날짜}")).toEqual([]);
  });
});

describe("convertLegacyTokens", () => {
  it("%%학생 → {이름} 으로 바꾼다", () => {
    const out = convertLegacyTokens(REAL_BODY);
    expect(out).not.toContain("%%학생");
    expect(out).toContain("{이름}");
  });

  it("본문의 나머지는 건드리지 않는다", () => {
    const out = convertLegacyTokens(REAL_BODY);
    expect(out).toContain("【반포세정】");
    expect(out).toContain("문자전용: 010-8942-3488");
    expect(out).toBe(REAL_BODY.replace("%%학생", "{이름}"));
  });

  it("여러 번 등장해도 모두 치환", () => {
    expect(convertLegacyTokens("%%학생 %%학생")).toBe("{이름} {이름}");
  });

  it("변환표에 없는 토큰은 그대로 둔다 (임의 삭제 금지)", () => {
    expect(convertLegacyTokens("%%학생 %%반이름")).toBe("{이름} %%반이름");
  });

  it("토큰이 없으면 원본 그대로", () => {
    const plain = "안녕하세요 {이름} 님";
    expect(convertLegacyTokens(plain)).toBe(plain);
  });
});

describe("hasConvertibleLegacyToken", () => {
  it("%%학생 이 있으면 true", () => {
    expect(hasConvertibleLegacyToken(REAL_BODY)).toBe(true);
  });

  it("변환 불가 토큰만 있으면 false", () => {
    expect(hasConvertibleLegacyToken("%%반이름")).toBe(false);
  });

  it("토큰이 없으면 false", () => {
    expect(hasConvertibleLegacyToken("{이름} 님")).toBe(false);
  });
});
