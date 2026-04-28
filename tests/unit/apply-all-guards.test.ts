import { describe, it, expect } from "vitest";
import {
  applyAllGuards,
  type Recipient,
} from "@/lib/messaging/guards";

/**
 * F3-A · 통합 가드(`applyAllGuards`) 테스트.
 *
 * 개별 가드의 조합 시나리오:
 *   - 본문 변환: insertAdTag → insertUnsubscribeFooter 순서.
 *   - 수신자 필터: 탈퇴/수신거부 적용.
 *   - 야간 차단: isAd=true 에서만 활성화.
 */

function r(
  id: string,
  phone: string,
  status: string = "재원생",
  name: string = "학생",
): Recipient {
  return { studentId: id, phone, name, status };
}

describe("applyAllGuards · 광고 낮 시간 정상 케이스", () => {
  it("(광고) prefix + footer 삽입 + 발송 허용 + 전원 eligible", () => {
    const out = applyAllGuards({
      body: "여름 특강 모집",
      isAd: true,
      scheduledAt: new Date("2026-04-22T14:00:00+09:00"),
      recipients: [r("s1", "01011112222"), r("s2", "01033334444")],
      unsubscribedPhones: [],
      optOutNumber: "080-111-2222",
    });
    expect(out.finalBody.startsWith("(광고) ")).toBe(true);
    expect(out.finalBody).toContain("여름 특강 모집");
    expect(out.finalBody).toContain("무료수신거부 080-111-2222");
    expect(out.allowedToSend).toBe(true);
    expect(out.blockReason).toBeUndefined();
    expect(out.eligible).toHaveLength(2);
    expect(out.excluded).toHaveLength(0);
  });
});

describe("applyAllGuards · 광고 야간 차단", () => {
  it("2026-04-22T22:00 KST + isAd=true → allowedToSend=false · reason 한글", () => {
    const out = applyAllGuards({
      body: "야간 광고",
      isAd: true,
      scheduledAt: new Date("2026-04-22T22:00:00+09:00"),
      recipients: [r("s1", "01011112222")],
      unsubscribedPhones: [],
      optOutNumber: "080-111-2222",
    });
    expect(out.allowedToSend).toBe(false);
    expect(out.blockReason).toBeTruthy();
    expect(out.blockReason).toContain("야간");
    // 본문 변환은 야간이어도 진행됨(차단은 발송 여부만 결정)
    expect(out.finalBody.startsWith("(광고) ")).toBe(true);
  });
});

describe("applyAllGuards · 수신자 제외 + 정상 혼합", () => {
  it("탈퇴 1 + 수신거부 1 + 정상 2 → eligible 2 · excluded 2 · 사유 분리", () => {
    const out = applyAllGuards({
      body: "공지",
      isAd: true,
      scheduledAt: new Date("2026-04-22T14:00:00+09:00"),
      recipients: [
        r("s1", "01011112222", "재원생"),
        r("s2", "01033334444", "탈퇴"),
        r("s3", "01055556666", "수강이력자"),
        r("s4", "01077778888", "재원생"),
      ],
      unsubscribedPhones: ["010-5555-6666"],
      optOutNumber: "080-111-2222",
    });
    expect(out.allowedToSend).toBe(true);
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

describe("applyAllGuards · 정보성 문자(isAd=false)", () => {
  it("prefix/footer 삽입 안 됨 · 야간 무관 허용", () => {
    const out = applyAllGuards({
      body: "개강 안내",
      isAd: false,
      scheduledAt: new Date("2026-04-22T23:30:00+09:00"), // 야간이지만 정보성
      recipients: [r("s1", "01011112222")],
      unsubscribedPhones: [],
    });
    expect(out.finalBody).toBe("개강 안내");
    expect(out.allowedToSend).toBe(true);
    expect(out.blockReason).toBeUndefined();
    expect(out.eligible).toHaveLength(1);
  });

  it("정보성 + 탈퇴 학생 1명도 정상적으로 제외됨", () => {
    const out = applyAllGuards({
      body: "개강 안내",
      isAd: false,
      scheduledAt: new Date("2026-04-22T14:00:00+09:00"),
      recipients: [
        r("s1", "01011112222", "재원생"),
        r("s2", "01033334444", "탈퇴"),
      ],
      unsubscribedPhones: [],
    });
    expect(out.eligible).toHaveLength(1);
    expect(out.eligible[0].studentId).toBe("s1");
    expect(out.excluded[0].reason).toBe("탈퇴학생");
  });
});
