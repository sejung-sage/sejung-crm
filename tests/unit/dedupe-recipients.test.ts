import { describe, it, expect } from "vitest";
import {
  collapseByPhone,
  type DedupeRecipient,
} from "@/lib/messaging/dedupe-recipients";

/**
 * F3 · 동일번호 1회 발송(중복 번호 dedupe) collapse 순수 함수.
 *
 * 같은 학부모 번호로 묶인 형제 N명을 1건으로 합쳐 발송하기 위한 로직.
 *
 * 안전성 계약 (절대 약화 금지):
 *   - collapse 는 발송 안전 가드(applyAllGuards) **통과 직후** eligible 배열에만 적용.
 *     즉 탈퇴/수신거부/야간 row 는 collapse 이전 단계에서 이미 빠지므로, 본 함수
 *     입력에는 가드 통과분만 들어온다 (순수 함수라 가드는 입력 전제).
 *   - dedupe 기준은 정규화 번호(\D 제거된 phone). 호출자가 정규화 책임.
 *   - 같은 번호 그룹에서 **첫 row 만 유지** (입력이 registered_at DESC 순 →
 *     최근 등록 학생이 대표).
 *   - dedupe OFF → 입력 그대로 통과, collapsed=0.
 *
 * 불변식: collapsed = targetStudents - actualMessages (>= 0).
 */

/** 테스트 픽스처 빌더. studentId/phone/name 최소 형태. */
function rcpt(
  studentId: string | null,
  phone: string,
  name: string,
): DedupeRecipient {
  return { studentId, phone, name };
}

describe("collapseByPhone · dedupe OFF", () => {
  it("입력을 그대로 통과시키고 collapsed=0", () => {
    const input = [
      rcpt("s1", "01011112222", "김첫째"),
      rcpt("s2", "01011112222", "김둘째"),
      rcpt("s3", "01033334444", "이단독"),
    ];
    const { recipients, counts } = collapseByPhone(input, false);
    expect(recipients).toEqual(input);
    expect(recipients.length).toBe(3);
    expect(counts.dedupeApplied).toBe(false);
    expect(counts.targetStudents).toBe(3);
    expect(counts.actualMessages).toBe(3);
    expect(counts.collapsed).toBe(0);
  });

  it("OFF 면 같은 번호가 있어도 합치지 않는다 (actualMessages = targetStudents)", () => {
    const input = [
      rcpt("s1", "01011112222", "형"),
      rcpt("s2", "01011112222", "동생"),
    ];
    const { recipients, counts } = collapseByPhone(input, false);
    expect(recipients.length).toBe(2);
    expect(counts.actualMessages).toBe(counts.targetStudents);
    expect(counts.collapsed).toBe(0);
  });

  it("OFF · 동일 배열 참조를 그대로 반환 (재할당 없음)", () => {
    const input = [rcpt("s1", "01011112222", "단독")];
    const { recipients } = collapseByPhone(input, false);
    expect(recipients).toBe(input);
  });
});

describe("collapseByPhone · dedupe ON · 합치기", () => {
  it("같은 번호 2명 → 1건으로 합쳐지고 첫 row(=최근 등록) 유지", () => {
    const input = [
      rcpt("s1", "01011112222", "최근등록"),
      rcpt("s2", "01011112222", "예전등록"),
    ];
    const { recipients, counts } = collapseByPhone(input, true);
    expect(recipients.length).toBe(1);
    expect(recipients[0]?.studentId).toBe("s1");
    expect(recipients[0]?.name).toBe("최근등록");
    expect(counts.dedupeApplied).toBe(true);
    expect(counts.targetStudents).toBe(2);
    expect(counts.actualMessages).toBe(1);
    expect(counts.collapsed).toBe(1);
  });

  it("같은 번호 3명(형제 3) → 1건, 첫 row 대표, collapsed=2", () => {
    const input = [
      rcpt("s1", "01011112222", "첫째"),
      rcpt("s2", "01011112222", "둘째"),
      rcpt("s3", "01011112222", "셋째"),
    ];
    const { recipients, counts } = collapseByPhone(input, true);
    expect(recipients.length).toBe(1);
    expect(recipients[0]?.studentId).toBe("s1");
    expect(counts.targetStudents).toBe(3);
    expect(counts.actualMessages).toBe(1);
    expect(counts.collapsed).toBe(2);
  });

  it("서로 다른 번호는 합쳐지지 않고 모두 보존 + 입력 순서 유지", () => {
    const input = [
      rcpt("s1", "01011112222", "A"),
      rcpt("s2", "01033334444", "B"),
      rcpt("s3", "01055556666", "C"),
    ];
    const { recipients, counts } = collapseByPhone(input, true);
    expect(recipients.map((r) => r.studentId)).toEqual(["s1", "s2", "s3"]);
    expect(counts.targetStudents).toBe(3);
    expect(counts.actualMessages).toBe(3);
    expect(counts.collapsed).toBe(0);
  });

  it("중복 그룹과 단독 번호 혼재 → 각 그룹 첫 row, 입력 순서 보존", () => {
    // 입력은 registered_at DESC 가정. 같은 번호 그룹의 선두가 대표.
    const input = [
      rcpt("s1", "01011112222", "김형"), // 그룹A 대표
      rcpt("s2", "01033334444", "이단독"),
      rcpt("s3", "01011112222", "김동생"), // 그룹A 합쳐짐
      rcpt("s4", "01055556666", "박형"), // 그룹B 대표
      rcpt("s5", "01055556666", "박동생"), // 그룹B 합쳐짐
    ];
    const { recipients, counts } = collapseByPhone(input, true);
    expect(recipients.map((r) => r.studentId)).toEqual(["s1", "s2", "s4"]);
    expect(counts.targetStudents).toBe(5);
    expect(counts.actualMessages).toBe(3);
    expect(counts.collapsed).toBe(2);
  });

  it("studentId 가 null 이어도(가져온 적 없는 학생) 번호 기준으로 합쳐진다", () => {
    const input = [
      rcpt(null, "01011112222", "대표"),
      rcpt(null, "01011112222", "합쳐짐"),
    ];
    const { recipients, counts } = collapseByPhone(input, true);
    expect(recipients.length).toBe(1);
    expect(recipients[0]?.name).toBe("대표");
    expect(counts.collapsed).toBe(1);
  });
});

describe("collapseByPhone · 빈 phone 처리", () => {
  it('빈 phone("") 들은 합치지 않고 각각 보존', () => {
    const input = [
      rcpt("s1", "", "번호없음1"),
      rcpt("s2", "", "번호없음2"),
      rcpt("s3", "", "번호없음3"),
    ];
    const { recipients, counts } = collapseByPhone(input, true);
    expect(recipients.length).toBe(3);
    expect(recipients.map((r) => r.studentId)).toEqual(["s1", "s2", "s3"]);
    expect(counts.targetStudents).toBe(3);
    expect(counts.actualMessages).toBe(3);
    expect(counts.collapsed).toBe(0);
  });

  it("빈 phone 과 실제 번호 그룹 혼재 → 빈 phone 은 보존, 번호는 합쳐짐", () => {
    const input = [
      rcpt("s1", "", "번호없음"),
      rcpt("s2", "01011112222", "형"),
      rcpt("s3", "01011112222", "동생"),
      rcpt("s4", "", "번호없음2"),
    ];
    const { recipients, counts } = collapseByPhone(input, true);
    // 빈 phone 2건 + 합쳐진 번호 1건 = 3건
    expect(recipients.map((r) => r.studentId)).toEqual(["s1", "s2", "s4"]);
    expect(counts.targetStudents).toBe(4);
    expect(counts.actualMessages).toBe(3);
    expect(counts.collapsed).toBe(1);
  });
});

describe("collapseByPhone · 경계값", () => {
  it("빈 배열 → 빈 결과, 모든 카운트 0", () => {
    const offResult = collapseByPhone([], false);
    expect(offResult.recipients).toEqual([]);
    expect(offResult.counts).toEqual({
      dedupeApplied: false,
      targetStudents: 0,
      legs: 0,
      actualMessages: 0,
      collapsed: 0,
    });

    const onResult = collapseByPhone([], true);
    expect(onResult.recipients).toEqual([]);
    expect(onResult.counts).toEqual({
      dedupeApplied: true,
      targetStudents: 0,
      legs: 0,
      actualMessages: 0,
      collapsed: 0,
    });
  });

  it("단일 입력 · ON → 그대로 1건, collapsed=0", () => {
    const input = [rcpt("s1", "01011112222", "단독")];
    const { recipients, counts } = collapseByPhone(input, true);
    expect(recipients.length).toBe(1);
    expect(counts.targetStudents).toBe(1);
    expect(counts.actualMessages).toBe(1);
    expect(counts.collapsed).toBe(0);
  });

  it("대량(5,000건 전부 같은 번호) → 1건으로 합쳐짐, collapsed=4999", () => {
    const input: DedupeRecipient[] = Array.from({ length: 5000 }, (_, i) =>
      rcpt(`s${i}`, "01011112222", `학생${i}`),
    );
    const { recipients, counts } = collapseByPhone(input, true);
    expect(recipients.length).toBe(1);
    expect(recipients[0]?.studentId).toBe("s0"); // 선두 유지
    expect(counts.targetStudents).toBe(5000);
    expect(counts.actualMessages).toBe(1);
    expect(counts.collapsed).toBe(4999);
  });

  it("대량(5,000건 전부 고유 번호) → 합치기 없음, collapsed=0", () => {
    const input: DedupeRecipient[] = Array.from({ length: 5000 }, (_, i) =>
      // 11자리 고유 번호 생성
      rcpt(`s${i}`, `010${String(10000000 + i).padStart(8, "0")}`, `학생${i}`),
    );
    const { recipients, counts } = collapseByPhone(input, true);
    expect(recipients.length).toBe(5000);
    expect(counts.targetStudents).toBe(5000);
    expect(counts.actualMessages).toBe(5000);
    expect(counts.collapsed).toBe(0);
  });
});

describe("collapseByPhone · 카운트 불변식", () => {
  // 무작위/조합 입력에서도 항상 성립해야 하는 계약.
  const scenarios: Array<{ name: string; input: DedupeRecipient[] }> = [
    { name: "빈 배열", input: [] },
    {
      name: "전부 고유",
      input: [
        rcpt("s1", "01011112222", "A"),
        rcpt("s2", "01033334444", "B"),
      ],
    },
    {
      name: "전부 중복",
      input: [
        rcpt("s1", "01011112222", "A"),
        rcpt("s2", "01011112222", "B"),
        rcpt("s3", "01011112222", "C"),
      ],
    },
    {
      name: "혼재 + 빈 phone",
      input: [
        rcpt("s1", "01011112222", "A"),
        rcpt("s2", "01011112222", "B"),
        rcpt("s3", "", "C"),
        rcpt("s4", "01055556666", "D"),
      ],
    },
  ];

  for (const { name, input } of scenarios) {
    it(`[${name}] ON · collapsed = targetStudents - actualMessages >= 0`, () => {
      const { counts } = collapseByPhone(input, true);
      expect(counts.collapsed).toBe(
        counts.targetStudents - counts.actualMessages,
      );
      expect(counts.collapsed).toBeGreaterThanOrEqual(0);
      expect(counts.actualMessages).toBeLessThanOrEqual(counts.targetStudents);
    });

    it(`[${name}] OFF · actualMessages = targetStudents, collapsed = 0`, () => {
      const { counts } = collapseByPhone(input, false);
      expect(counts.actualMessages).toBe(counts.targetStudents);
      expect(counts.collapsed).toBe(0);
      expect(counts.dedupeApplied).toBe(false);
    });
  }

  it("ON · actualMessages = (고유 번호 수 + 빈 phone 수)", () => {
    const input = [
      rcpt("s1", "01011112222", "A"),
      rcpt("s2", "01011112222", "B"), // 합쳐짐
      rcpt("s3", "01033334444", "C"),
      rcpt("s4", "", "D"), // 빈 phone 보존
      rcpt("s5", "", "E"), // 빈 phone 보존
    ];
    // 고유 번호 2개 + 빈 phone 2건 = 4
    const { counts } = collapseByPhone(input, true);
    expect(counts.actualMessages).toBe(4);
  });

  it("dedupeApplied 는 인자 dedupeByPhone 을 그대로 반영", () => {
    const input = [rcpt("s1", "01011112222", "A")];
    expect(collapseByPhone(input, true).counts.dedupeApplied).toBe(true);
    expect(collapseByPhone(input, false).counts.dedupeApplied).toBe(false);
  });
});

describe("collapseByPhone · 레그(leg) 모델 + targetStudents 주입 (0077)", () => {
  // 레그 확장(expandRecipientLegs) 후 collapse 입력은 "레그(번호) 배열" 이다.
  // 한 학생이 학부모·학생 양쪽을 선택하면 같은 studentId 가 다른 phone 으로
  // 2 row 들어온다. targetStudents 는 호출자(레그 확장 전 단계)가 더 정확히
  // 알기 때문에 옵션으로 주입한다.

  it("동시 발송 legs=2N 인데 학생=학부모 동일번호면 collapse 로 actualMessages < legs", () => {
    // s1 의 학부모 번호 == 학생 번호 (학부모 휴대폰에 학생도 등록된 케이스).
    const legs = [
      rcpt("s1", "01011112222", "김학생"), // 학부모 레그
      rcpt("s1", "01011112222", "김학생"), // 학생 레그(동일번호)
    ];
    const { recipients, counts } = collapseByPhone(legs, true, 1);
    expect(recipients.length).toBe(1);
    expect(counts.targetStudents).toBe(1); // 사람 1명
    expect(counts.legs).toBe(2); // 레그 2개
    expect(counts.actualMessages).toBe(1); // 합쳐짐
    expect(counts.collapsed).toBe(1);
    expect(counts.actualMessages).toBeLessThan(counts.legs);
  });

  it("형제 2명이 같은 학부모 번호 공유 (학부모만 발송) → 1건, targetStudents=2", () => {
    // 학부모만 발송: 형제 각각 학부모 레그 1개씩, 같은 번호.
    const legs = [
      rcpt("s1", "01011112222", "형"),
      rcpt("s2", "01011112222", "동생"),
    ];
    const { recipients, counts } = collapseByPhone(legs, true, 2);
    expect(recipients.length).toBe(1);
    expect(counts.targetStudents).toBe(2); // 사람 2명
    expect(counts.legs).toBe(2);
    expect(counts.actualMessages).toBe(1);
    expect(counts.collapsed).toBe(1);
  });

  it("불변식 actualMessages = legs - collapsed (targetStudents 주입)", () => {
    const legs = [
      rcpt("s1", "01011110000", "A"), // 학부모
      rcpt("s1", "01011119999", "A"), // 학생(다른 번호)
      rcpt("s2", "01011110000", "B"), // 형제, A 와 같은 학부모 번호 → 합쳐짐
    ];
    const { counts } = collapseByPhone(legs, true, 2);
    expect(counts.legs).toBe(3);
    expect(counts.actualMessages).toBe(2); // 01011110000, 01011119999
    expect(counts.collapsed).toBe(1);
    expect(counts.actualMessages).toBe(counts.legs - counts.collapsed);
  });

  it("불변식 legs >= targetStudents (주입 시)", () => {
    // 학부모·학생 동시 발송 → 2명에서 레그 4개. dedupe 후에도 legs >= targetStudents.
    const legs = [
      rcpt("s1", "01011110000", "A"),
      rcpt("s1", "01022220000", "A"),
      rcpt("s2", "01033330000", "B"),
      rcpt("s2", "01044440000", "B"),
    ];
    const { counts } = collapseByPhone(legs, true, 2);
    expect(counts.legs).toBe(4);
    expect(counts.targetStudents).toBe(2);
    expect(counts.legs).toBeGreaterThanOrEqual(counts.targetStudents);
  });

  it("dedupe OFF · 레그 모델 → actualMessages = legs (합치기 없음, targetStudents 주입)", () => {
    const legs = [
      rcpt("s1", "01011112222", "김학생"), // 학부모
      rcpt("s1", "01011112222", "김학생"), // 학생(동일번호) — OFF 라 합쳐지지 않음
    ];
    const { recipients, counts } = collapseByPhone(legs, false, 1);
    expect(recipients.length).toBe(2);
    expect(counts.targetStudents).toBe(1);
    expect(counts.legs).toBe(2);
    expect(counts.actualMessages).toBe(2); // = legs
    expect(counts.collapsed).toBe(0);
  });

  it("targetStudents 미주입이면 입력 고유 studentId 수로 추정 (레그 2개 학생도 1명)", () => {
    const legs = [
      rcpt("s1", "01011110000", "A"), // 학부모
      rcpt("s1", "01022220000", "A"), // 학생
    ];
    const { counts } = collapseByPhone(legs, true); // targetStudents 미주입
    expect(counts.targetStudents).toBe(1); // 고유 studentId 수
    expect(counts.legs).toBe(2);
  });

  it("주입 targetStudents 는 collapse 결과 배열에 영향 없음 (카운트 표시용)", () => {
    const legs = [
      rcpt("s1", "01011110000", "A"),
      rcpt("s2", "01022220000", "B"),
    ];
    const withInject = collapseByPhone(legs, true, 2);
    const withoutInject = collapseByPhone(legs, true);
    expect(withInject.recipients).toEqual(withoutInject.recipients);
  });
});

describe("collapseByPhone · 가드 독립성 회귀 (입력 전제)", () => {
  // collapse 는 순수 함수라 가드를 우회/추가하지 않는다.
  // 입력에 없는 번호는 결과에도 절대 없다 = collapse 가 새 수신자를 만들지 않음.
  it("결과의 모든 번호는 입력에 존재했던 번호다 (새 수신자 생성 금지)", () => {
    const input = [
      rcpt("s1", "01011112222", "A"),
      rcpt("s2", "01011112222", "B"),
      rcpt("s3", "01033334444", "C"),
    ];
    const inputPhones = new Set(input.map((r) => r.phone));
    const { recipients } = collapseByPhone(input, true);
    for (const r of recipients) {
      expect(inputPhones.has(r.phone)).toBe(true);
    }
  });

  it("결과의 모든 row 는 입력 배열의 동일 객체 참조다 (변형/복제 없음)", () => {
    const input = [
      rcpt("s1", "01011112222", "A"),
      rcpt("s2", "01011112222", "B"),
    ];
    const { recipients } = collapseByPhone(input, true);
    expect(recipients[0]).toBe(input[0]); // 첫 row 동일 참조
  });

  it("탈퇴/수신거부가 입력에서 이미 제거됐다면 결과에도 없다 (계약상 전제)", () => {
    // 가드 통과분만 입력으로 들어온다는 전제. 여기엔 탈퇴 학생이 없다.
    // collapse 가 제거된 학생을 되살리지 않음을 결과 크기로 확인.
    const guardPassed = [
      rcpt("s1", "01011112222", "재원"),
      rcpt("s2", "01033334444", "재원2"),
    ];
    const { recipients } = collapseByPhone(guardPassed, true);
    expect(recipients.length).toBe(2);
    // 입력에 없던 어떤 번호도 등장하지 않는다.
    expect(recipients.every((r) => r.phone !== "01099998888")).toBe(true);
  });
});
