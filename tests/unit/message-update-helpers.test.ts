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

describe("readFromNumber · 어댑터별 발신번호 (env 단일 소스)", () => {
  const ORIGINAL = process.env.SENDON_FROM_NUMBER;

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.SENDON_FROM_NUMBER;
    } else {
      process.env.SENDON_FROM_NUMBER = ORIGINAL;
    }
  });

  it("sendon → SENDON_FROM_NUMBER env 값을 반환", () => {
    process.env.SENDON_FROM_NUMBER = "0212345678";
    expect(readFromNumber("sendon")).toBe("0212345678");
  });

  it("sendon + env 미설정 → 하드코딩 fallback('01000000000')", () => {
    // 하드코딩 금지 가드의 예외: env 누락 시 더미 fallback(실 발송은 dev-seed 차단).
    delete process.env.SENDON_FROM_NUMBER;
    expect(readFromNumber("sendon")).toBe("01000000000");
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
