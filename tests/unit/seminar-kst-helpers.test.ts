import { describe, it, expect } from "vitest";
import {
  combineKstDateTime,
  datetimeLocalToKstIso,
} from "@/lib/seminars/kst-datetime";

/**
 * F5 · 설명회 폼 KST 일시 → UTC ISO 변환 헬퍼 단위 테스트.
 *
 * `new-seminar-form.tsx` 가 폼 입력값을 RPC INSERT 페이로드로 직렬화할 때
 * 호출. 입력 형태별 (date+time 분리 / datetime-local 통합) 동일하게 KST → UTC
 * 변환되어야 한다. 잘못된 입력은 모두 null — 호출부가 NULL 컬럼으로 INSERT.
 */

describe("combineKstDateTime · 정상 입력", () => {
  it('"2026-06-08" + "19:00" → KST 19:00 == UTC 10:00 ISO', () => {
    expect(combineKstDateTime("2026-06-08", "19:00")).toBe(
      "2026-06-08T10:00:00.000Z",
    );
  });

  it('"2026-01-01" + "00:00" → KST 자정 == 전날 UTC 15:00', () => {
    expect(combineKstDateTime("2026-01-01", "00:00")).toBe(
      "2025-12-31T15:00:00.000Z",
    );
  });

  it("앞뒤 공백은 trim 후 정상 변환", () => {
    expect(combineKstDateTime("  2026-06-08 ", "  19:00 ")).toBe(
      "2026-06-08T10:00:00.000Z",
    );
  });
});

describe("combineKstDateTime · 경계·실패", () => {
  it("date 가 빈 문자열이면 null", () => {
    expect(combineKstDateTime("", "19:00")).toBeNull();
  });

  it("time 이 빈 문자열이면 null", () => {
    expect(combineKstDateTime("2026-06-08", "")).toBeNull();
  });

  it("둘 다 빈 문자열이면 null", () => {
    expect(combineKstDateTime("", "")).toBeNull();
  });

  it("공백만 들어와도 null", () => {
    expect(combineKstDateTime("   ", "   ")).toBeNull();
  });

  it('비정상 입력("not-a-date" / "ab:cd") → null', () => {
    expect(combineKstDateTime("not-a-date", "19:00")).toBeNull();
    expect(combineKstDateTime("2026-06-08", "ab:cd")).toBeNull();
  });
});

describe("datetimeLocalToKstIso · 정상 입력", () => {
  it('"2026-06-08T14:30" → KST 14:30 == UTC 05:30 ISO', () => {
    expect(datetimeLocalToKstIso("2026-06-08T14:30")).toBe(
      "2026-06-08T05:30:00.000Z",
    );
  });

  it('"2026-12-31T23:59" → KST 23:59 == UTC 14:59 ISO', () => {
    expect(datetimeLocalToKstIso("2026-12-31T23:59")).toBe(
      "2026-12-31T14:59:00.000Z",
    );
  });

  it("공백 trim 후 정상 변환", () => {
    expect(datetimeLocalToKstIso("  2026-06-08T14:30  ")).toBe(
      "2026-06-08T05:30:00.000Z",
    );
  });
});

describe("datetimeLocalToKstIso · 경계·실패", () => {
  it("빈 값 → null", () => {
    expect(datetimeLocalToKstIso("")).toBeNull();
  });

  it("공백만 → null", () => {
    expect(datetimeLocalToKstIso("   ")).toBeNull();
  });

  it("형식 깨진 입력 → null", () => {
    expect(datetimeLocalToKstIso("not-a-date")).toBeNull();
  });
});
