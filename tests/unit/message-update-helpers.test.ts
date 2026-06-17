import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  readFromNumber,
  extractFailedReason,
} from "@/lib/messaging/message-update-helpers";
import type { SmsSendResult } from "@/types/messaging";

/**
 * F3 Part B · 발송 결과 반영 공용 헬퍼 — 순수 함수 단위 테스트.
 *
 * `message-update-helpers` 는 일괄 재발송(`resend-failed`)에서 추출돼 단건
 * 재발송(`resend-single`)과 공유되는 모듈이다. 추출 회귀 방어를 위해 부수효과
 * 없는 두 함수를 직접 검증한다.
 *
 *   - readFromNumber      : 어댑터명 → 발신번호(env). sendon 만 인식, 그 외 null.
 *   - extractFailedReason : 벤더 응답/예외 → 실패 사유 문자열.
 *
 * updateMessage / safeUpdateCampaignStatus / incrementCampaignCost 는 Supabase
 * 클라이언트 부수효과 함수라 실 DB(E2E)에서 검증한다.
 */

describe("readFromNumber · 분원별 발신번호 (env)", () => {
  const ENV_KEYS = [
    "SENDON_FROM_NUMBER",
    "SENDON_FROM_NUMBER_DAECHI",
    "SENDON_FROM_NUMBER_SONGDO",
    "SENDON_FROM_NUMBER_BANPO",
    "SENDON_FROM_NUMBER_BANGBAE",
  ] as const;
  const ORIGINAL: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) ORIGINAL[k] = process.env[k];

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (ORIGINAL[k] === undefined) delete process.env[k];
      else process.env[k] = ORIGINAL[k];
    }
  });

  it("sendon · branch 없음 → SENDON_FROM_NUMBER 폴백값", () => {
    process.env.SENDON_FROM_NUMBER = "0212345678";
    expect(readFromNumber("sendon")).toBe("0212345678");
  });

  it("sendon · 분원 전용 키가 있으면 그 값을 반환", () => {
    process.env.SENDON_FROM_NUMBER = "025670606";
    process.env.SENDON_FROM_NUMBER_SONGDO = "0328580005";
    expect(readFromNumber("sendon", "송도")).toBe("0328580005");
    expect(readFromNumber("sendon", "대치")).toBe("025670606"); // 키 미설정 → 폴백
  });

  it("sendon · 하이픈 섞인 env 도 숫자만 추출", () => {
    process.env.SENDON_FROM_NUMBER_BANPO = "02-6242-0909";
    expect(readFromNumber("sendon", "반포")).toBe("0262420909");
  });

  it("sendon · 분원 키·폴백 모두 미설정 → null (호출부가 발송 거부)", () => {
    delete process.env.SENDON_FROM_NUMBER;
    expect(readFromNumber("sendon", "방배")).toBeNull();
    expect(readFromNumber("sendon")).toBeNull();
  });

  it("알 수 없는 어댑터명 → null (호출부가 발송 거부)", () => {
    expect(readFromNumber("solapi")).toBeNull();
    expect(readFromNumber("munjanara")).toBeNull();
  });

  it("빈 문자열 어댑터명 → null", () => {
    expect(readFromNumber("")).toBeNull();
  });
});

describe("extractFailedReason · 벤더 응답/예외에서 사유 추출", () => {
  it("rejected + Error → Error.message 그대로", () => {
    const sr: PromiseSettledResult<SmsSendResult> = {
      status: "rejected",
      reason: new Error("타임아웃: 벤더 무응답"),
    };
    expect(extractFailedReason(sr)).toBe("타임아웃: 벤더 무응답");
  });

  it("rejected + non-Error(문자열 throw) → '벤더 응답 오류' fallback", () => {
    const sr: PromiseSettledResult<SmsSendResult> = {
      status: "rejected",
      reason: "string-error",
    };
    expect(extractFailedReason(sr)).toBe("벤더 응답 오류");
  });

  it("fulfilled + status 'failed' → value.reason 그대로", () => {
    const sr: PromiseSettledResult<SmsSendResult> = {
      status: "fulfilled",
      value: { status: "failed", reason: "잔액 부족" },
    };
    expect(extractFailedReason(sr)).toBe("잔액 부족");
  });

  it("fulfilled + status 'queued'(비정상 경로) → '벤더 응답이 비정상입니다'", () => {
    // queued 인데 실패 사유를 뽑으려는 모순 상황 → 방어적 fallback.
    const sr: PromiseSettledResult<SmsSendResult> = {
      status: "fulfilled",
      value: { status: "queued", vendorMessageId: "v-1", cost: 7.4 },
    };
    expect(extractFailedReason(sr)).toBe("벤더 응답이 비정상입니다");
  });

  it("undefined(결과 누락) → '발송 결과를 읽지 못했습니다'", () => {
    expect(extractFailedReason(undefined)).toBe("발송 결과를 읽지 못했습니다");
  });
});
