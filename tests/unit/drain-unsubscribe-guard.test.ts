/**
 * 드레인 워커 "수신거부 하드 가드" 단위 테스트 (회귀 방어).
 *
 * 버그: 수신거부는 메시지 생성 시점에만 걸렸다. 예약 발송·실패 재발송·중단 캠페인
 * 재개처럼 이미 만들어 둔 '대기' 행을 나중에 다시 드레인하는 경로는, 생성 이후
 * 수신거부한 번호를 걸러내지 못하고 그대로 발송했다. 발송 직전 마지막 방어선인
 * splitUnsubscribed 가 '대기' 를 sendable / blocked 로 정확히 가르는지 검증한다.
 * 비교는 하이픈 제거된 숫자 문자열 기준(unsubSet 도 정규화된 값).
 */

import { describe, it, expect } from "vitest";
import { splitUnsubscribed } from "@/lib/messaging/drain-campaign";

type PendingRow = { id: string; phone: string; student_id: string | null };

const row = (id: string, phone: string, studentId: string | null = null): PendingRow => ({
  id,
  phone,
  student_id: studentId,
});

describe("splitUnsubscribed · 발송 직전 수신거부 하드 가드", () => {
  describe("기본 분류", () => {
    it("수신거부 번호는 blocked, 나머지는 sendable 로 갈린다", () => {
      const pending = [
        row("m1", "01011112222"),
        row("m2", "01033334444"),
        row("m3", "01055556666"),
      ];
      const unsubSet = new Set(["01033334444"]);

      const { sendable, blocked } = splitUnsubscribed(pending, unsubSet);

      expect(blocked.map((b) => b.id)).toEqual(["m2"]);
      expect(sendable.map((s) => s.id)).toEqual(["m1", "m3"]);
    });

    it("하이픈 포함 메시지 번호도 정규화 후 매칭돼 blocked 된다", () => {
      const pending = [
        row("m1", "010-1234-5678"),
        row("m2", "010-9999-0000"),
      ];
      // unsubSet 은 정규화(하이픈 제거) 값으로 저장된다.
      const unsubSet = new Set(["01012345678"]);

      const { sendable, blocked } = splitUnsubscribed(pending, unsubSet);

      expect(blocked.map((b) => b.id)).toEqual(["m1"]);
      expect(sendable.map((s) => s.id)).toEqual(["m2"]);
    });
  });

  describe("경계값", () => {
    it("unsubSet 이 비면 전원 sendable (기존 동작 보존)", () => {
      const pending = [
        row("m1", "01011112222"),
        row("m2", "010-3333-4444"),
      ];

      const { sendable, blocked } = splitUnsubscribed(pending, new Set());

      expect(blocked).toEqual([]);
      expect(sendable.map((s) => s.id)).toEqual(["m1", "m2"]);
    });

    it("전원 수신거부면 sendable 이 빈 배열 (드레인이 벤더 호출을 건너뛰는 조건)", () => {
      const pending = [
        row("m1", "010-1111-2222"),
        row("m2", "01033334444"),
      ];
      const unsubSet = new Set(["01011112222", "01033334444"]);

      const { sendable, blocked } = splitUnsubscribed(pending, unsubSet);

      expect(sendable).toEqual([]);
      expect(blocked.map((b) => b.id)).toEqual(["m1", "m2"]);
    });

    it("pending 이 비면 sendable·blocked 모두 빈 배열", () => {
      const { sendable, blocked } = splitUnsubscribed([], new Set(["01011112222"]));
      expect(sendable).toEqual([]);
      expect(blocked).toEqual([]);
    });
  });

  describe("불변성·순서", () => {
    it("원본 pending 배열을 변형하지 않는다", () => {
      const pending = [
        row("m1", "01011112222"),
        row("m2", "01033334444"),
      ];
      const snapshot = pending.map((p) => ({ ...p }));

      splitUnsubscribed(pending, new Set(["01033334444"]));

      expect(pending).toHaveLength(2);
      expect(pending).toEqual(snapshot);
    });

    it("입력 순서를 sendable·blocked 안에서 각각 보존한다", () => {
      const pending = [
        row("m1", "01000000001"),
        row("m2", "01000000002"),
        row("m3", "01000000003"),
        row("m4", "01000000004"),
      ];
      const unsubSet = new Set(["01000000002", "01000000004"]);

      const { sendable, blocked } = splitUnsubscribed(pending, unsubSet);

      expect(sendable.map((s) => s.id)).toEqual(["m1", "m3"]);
      expect(blocked.map((b) => b.id)).toEqual(["m2", "m4"]);
    });
  });
});
