import { describe, it, expect } from "vitest";
import {
  filterRecipients,
  type Recipient,
} from "@/lib/messaging/guards/filter-recipients";

/**
 * F3-A · 수신자 필터 가드.
 *
 * 구현 규약:
 *   1) status === '탈퇴' → 제외, reason = '탈퇴학생'
 *   2) phone(하이픈 제거 기준)이 unsubscribed_phones 에 포함 → 제외,
 *      reason = '수신거부'
 *   3) 비교는 하이픈 제거된 숫자 문자열 기준.
 */

function r(
  id: string,
  phone: string,
  status: string = "재원생",
  name: string = "학생",
): Recipient {
  return { studentId: id, phone, name, status };
}

describe("filterRecipients · 빈 입력", () => {
  it("recipients 빈 배열 → eligible/excluded 모두 빈 배열", () => {
    const out = filterRecipients([], []);
    expect(out.eligible).toEqual([]);
    expect(out.excluded).toEqual([]);
  });

  it("unsubscribed 빈 배열 · 정상 수신자만 있음 → 전원 eligible", () => {
    const out = filterRecipients(
      [r("s1", "01011112222"), r("s2", "01033334444")],
      [],
    );
    expect(out.eligible).toHaveLength(2);
    expect(out.excluded).toHaveLength(0);
  });
});

describe("filterRecipients · 탈퇴 학생 제외", () => {
  it("탈퇴 상태 학생 제외 + reason '탈퇴학생'", () => {
    const out = filterRecipients(
      [
        r("s1", "01011112222", "재원생"),
        r("s2", "01033334444", "탈퇴"),
      ],
      [],
    );
    expect(out.eligible.map((x) => x.studentId)).toEqual(["s1"]);
    expect(out.excluded).toHaveLength(1);
    expect(out.excluded[0].reason).toBe("탈퇴학생");
    expect(out.excluded[0].recipient.studentId).toBe("s2");
  });
});

describe("filterRecipients · 수신거부 번호 제외", () => {
  it("수신거부 번호와 정확히 일치 → 제외, reason='수신거부'", () => {
    const out = filterRecipients(
      [r("s1", "01011112222"), r("s2", "01033334444")],
      ["01011112222"],
    );
    expect(out.eligible.map((x) => x.studentId)).toEqual(["s2"]);
    expect(out.excluded).toHaveLength(1);
    expect(out.excluded[0].reason).toBe("수신거부");
  });

  it("하이픈 있는 번호로 수신거부 등록되어도 정규화 후 매칭", () => {
    const out = filterRecipients(
      [r("s1", "01011112222"), r("s2", "01033334444")],
      ["010-1111-2222"],
    );
    expect(out.eligible.map((x) => x.studentId)).toEqual(["s2"]);
    expect(out.excluded[0].recipient.studentId).toBe("s1");
    expect(out.excluded[0].reason).toBe("수신거부");
  });

  it("수신자 번호에 하이픈 있어도 정규화 후 매칭", () => {
    const out = filterRecipients(
      [r("s1", "010-1111-2222"), r("s2", "01033334444")],
      ["01011112222"],
    );
    expect(out.eligible.map((x) => x.studentId)).toEqual(["s2"]);
    expect(out.excluded[0].recipient.studentId).toBe("s1");
  });
});

describe("filterRecipients · 탈퇴 우선 판정", () => {
  it("탈퇴 + 수신거부 둘 다 해당 → 탈퇴 reason 우선 (구현 순서)", () => {
    const out = filterRecipients(
      [r("s1", "01011112222", "탈퇴")],
      ["01011112222"],
    );
    expect(out.excluded).toHaveLength(1);
    expect(out.excluded[0].reason).toBe("탈퇴학생");
  });
});

describe("filterRecipients · 복합 시나리오", () => {
  it("탈퇴 1 + 수신거부 1 + 정상 2 → eligible 2 · excluded 2", () => {
    const out = filterRecipients(
      [
        r("s1", "01011112222", "재원생"),
        r("s2", "01033334444", "탈퇴"),
        r("s3", "01055556666", "수강이력자"),
        r("s4", "01077778888", "재원생"),
      ],
      ["010-5555-6666"],
    );
    expect(out.eligible).toHaveLength(2);
    expect(out.eligible.map((x) => x.studentId).sort()).toEqual(["s1", "s4"]);
    expect(out.excluded).toHaveLength(2);
    const reasons = out.excluded.map((e) => ({
      id: e.recipient.studentId,
      reason: e.reason,
    }));
    expect(reasons).toContainEqual({ id: "s2", reason: "탈퇴학생" });
    expect(reasons).toContainEqual({ id: "s3", reason: "수신거부" });
  });
});
