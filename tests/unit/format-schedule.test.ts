import { describe, it, expect } from "vitest";
import {
  formatScheduleDisplay,
  isNightSchedule,
} from "@/lib/messaging/format-schedule";

/**
 * 예약 시각 표시 · 야간 판정.
 *
 * 배경(운영 요청 2026-08-20):
 *   예약 입력이 datetime-local 이라 브라우저가 오전/오후 선택식으로 보여주는데,
 *   확인 화면은 24시간 표기라 "오전 11시로 걸었다고 생각했는데 오후 11시" 같은
 *   착오가 눈에 안 들어왔다. 입력과 같은 어법(오전/오후)으로 되읽어 준다.
 */
describe("formatScheduleDisplay", () => {
  it("오전을 오전으로 되읽는다", () => {
    expect(formatScheduleDisplay("2026-08-21T11:01")).toBe(
      "2026년 8월 21일 (금) 오전 11:01",
    );
  });

  it("오후를 오후로 되읽는다 (착오 예약이 눈에 띄어야 함)", () => {
    expect(formatScheduleDisplay("2026-08-21T23:01")).toBe(
      "2026년 8월 21일 (금) 오후 11:01",
    );
  });

  it("정오는 오후 12시", () => {
    expect(formatScheduleDisplay("2026-08-21T12:00")).toBe(
      "2026년 8월 21일 (금) 오후 12:00",
    );
  });

  it("자정은 오전 12시", () => {
    expect(formatScheduleDisplay("2026-08-21T00:30")).toBe(
      "2026년 8월 21일 (금) 오전 12:30",
    );
  });

  it("파싱 불가하면 원문 그대로 (표시 전용이라 던지지 않음)", () => {
    expect(formatScheduleDisplay("이상한값")).toBe("이상한값");
  });
});

describe("isNightSchedule · 21시~08시", () => {
  it.each([
    ["2026-08-21T21:00", true],
    ["2026-08-21T23:59", true],
    ["2026-08-21T00:00", true],
    ["2026-08-21T07:59", true],
    ["2026-08-21T08:00", false],
    ["2026-08-21T11:01", false],
    ["2026-08-21T20:59", false],
  ])("%s → %s", (input, expected) => {
    expect(isNightSchedule(input as string)).toBe(expected);
  });

  it("파싱 불가하면 false", () => {
    expect(isNightSchedule("이상한값")).toBe(false);
  });
});
