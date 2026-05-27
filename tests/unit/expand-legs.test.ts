import { describe, it, expect } from "vitest";
import {
  expandRecipientLegs,
  countDistinctStudents,
} from "@/lib/messaging/expand-legs";
import type { GroupRecipient } from "@/lib/groups/load-all-group-recipients";

/**
 * F3 · 발송 대상 번호 선택(학부모/학생) 레그 확장 순수 함수 (0077).
 *
 * 학생 row 1개 → 최대 2개의 발송 레그(Recipient):
 *   - 학부모 레그: sendToParent && parent_phone 존재 → phone = parent_phone(정규화)
 *   - 학생   레그: sendToStudent && phone 존재        → phone = student.phone(정규화)
 * 번호가 없는 레그는 스킵(학생 1명 → 0·1·2 레그).
 *
 * 안전성 계약 (절대 약화 금지):
 *   - 수신거부는 "학생 row 제외" 가 아니라 "레그(번호) 제외" 로 독립 판정한다.
 *     학부모 번호 수신거부가 학생 번호 레그를 죽이면 안 됨 (반대도 마찬가지).
 *   - 번호는 \D 제거 정규화 후 비교(하이픈 포함 입력 허용).
 *   - 탈퇴 학생은 loadAllGroupRecipients 가 SQL 단에서 이미 제외 (본 함수 무관).
 *
 * 불변식: countDistinctStudents(legs) = 레그 1개 이상 생성된 고유 학생 수.
 */

/** GroupRecipient 픽스처 빌더. parent_phone/phone 은 null 가능. */
function row(
  id: string,
  name: string,
  parent_phone: string | null,
  phone: string | null,
  status: GroupRecipient["status"] = "재원생",
): GroupRecipient {
  return { id, name, parent_phone, phone, status };
}

describe("expandRecipientLegs · 학부모만 (parent=true, student=false)", () => {
  it("학부모 번호 있는 학생만 1레그 생성", () => {
    const rows = [
      row("s1", "김학생", "01011112222", "01099998888"),
      row("s2", "이학생", "01033334444", null),
    ];
    const legs = expandRecipientLegs(rows, {
      sendToParent: true,
      sendToStudent: false,
    });
    expect(legs).toHaveLength(2);
    expect(legs.map((l) => l.phone)).toEqual(["01011112222", "01033334444"]);
    expect(legs.map((l) => l.studentId)).toEqual(["s1", "s2"]);
    // 학부모 레그도 name 은 해당 학생 이름.
    expect(legs[0]?.name).toBe("김학생");
  });

  it("parent_phone 결측(null) 학생은 0레그", () => {
    const rows = [
      row("s1", "번호없음", null, "01099998888"),
      row("s2", "번호있음", "01033334444", null),
    ];
    const legs = expandRecipientLegs(rows, {
      sendToParent: true,
      sendToStudent: false,
    });
    expect(legs).toHaveLength(1);
    expect(legs[0]?.studentId).toBe("s2");
    expect(legs[0]?.phone).toBe("01033334444");
  });

  it("parent_phone 빈 문자열도 0레그 (정규화 후 빈값)", () => {
    const rows = [row("s1", "공백", "", "01099998888")];
    const legs = expandRecipientLegs(rows, {
      sendToParent: true,
      sendToStudent: false,
    });
    expect(legs).toHaveLength(0);
  });
});

describe("expandRecipientLegs · 학생만 (parent=false, student=true)", () => {
  it("student.phone 있는 학생만 1레그 생성", () => {
    const rows = [
      row("s1", "김학생", "01011112222", "01099998888"),
      row("s2", "이학생", "01033334444", null),
    ];
    const legs = expandRecipientLegs(rows, {
      sendToParent: false,
      sendToStudent: true,
    });
    expect(legs).toHaveLength(1);
    expect(legs[0]?.studentId).toBe("s1");
    expect(legs[0]?.phone).toBe("01099998888");
    expect(legs[0]?.name).toBe("김학생");
  });

  it("phone 결측(null) 학생은 0레그", () => {
    const rows = [
      row("s1", "학생번호없음", "01011112222", null),
      row("s2", "학생번호없음2", null, null),
    ];
    const legs = expandRecipientLegs(rows, {
      sendToParent: false,
      sendToStudent: true,
    });
    expect(legs).toHaveLength(0);
  });
});

describe("expandRecipientLegs · 둘 다 (parent=true, student=true)", () => {
  it("번호 둘 다 있으면 학부모·학생 2레그 (학부모 레그 먼저)", () => {
    const rows = [row("s1", "김학생", "01011112222", "01099998888")];
    const legs = expandRecipientLegs(rows, {
      sendToParent: true,
      sendToStudent: true,
    });
    expect(legs).toHaveLength(2);
    // 학부모 레그가 먼저 push (collapse 의 "첫 row 대표" 규약과 정렬).
    expect(legs[0]?.phone).toBe("01011112222");
    expect(legs[1]?.phone).toBe("01099998888");
    // 두 레그 모두 같은 학생을 가리킨다.
    expect(legs[0]?.studentId).toBe("s1");
    expect(legs[1]?.studentId).toBe("s1");
  });

  it("학생 번호만 결측이면 학부모 레그 1개만", () => {
    const rows = [row("s1", "김학생", "01011112222", null)];
    const legs = expandRecipientLegs(rows, {
      sendToParent: true,
      sendToStudent: true,
    });
    expect(legs).toHaveLength(1);
    expect(legs[0]?.phone).toBe("01011112222");
  });

  it("학부모 번호만 결측이면 학생 레그 1개만", () => {
    const rows = [row("s1", "김학생", null, "01099998888")];
    const legs = expandRecipientLegs(rows, {
      sendToParent: true,
      sendToStudent: true,
    });
    expect(legs).toHaveLength(1);
    expect(legs[0]?.phone).toBe("01099998888");
  });

  it("둘 다 결측이면 0레그", () => {
    const rows = [row("s1", "둘다없음", null, null)];
    const legs = expandRecipientLegs(rows, {
      sendToParent: true,
      sendToStudent: true,
    });
    expect(legs).toHaveLength(0);
  });

  it("여러 학생 혼재 — 각자 0·1·2 레그로 펼쳐지고 입력 순서 보존", () => {
    const rows = [
      row("s1", "둘다", "01011110000", "01022220000"), // 2레그
      row("s2", "학부모만", "01033330000", null), // 1레그
      row("s3", "학생만", null, "01044440000"), // 1레그
      row("s4", "둘다없음", null, null), // 0레그
    ];
    const legs = expandRecipientLegs(rows, {
      sendToParent: true,
      sendToStudent: true,
    });
    expect(legs.map((l) => l.phone)).toEqual([
      "01011110000", // s1 학부모
      "01022220000", // s1 학생
      "01033330000", // s2 학부모
      "01044440000", // s3 학생
    ]);
    expect(legs.map((l) => l.studentId)).toEqual(["s1", "s1", "s2", "s3"]);
  });
});

describe("expandRecipientLegs · 레그별 수신거부 (가드 강화)", () => {
  it("학부모 번호가 수신거부면 학부모 레그만 제외, 학생 레그는 생존", () => {
    const rows = [row("s1", "김학생", "01011112222", "01099998888")];
    const legs = expandRecipientLegs(rows, {
      sendToParent: true,
      sendToStudent: true,
      unsubscribedPhones: ["01011112222"], // 학부모 번호 수신거부
    });
    expect(legs).toHaveLength(1);
    expect(legs[0]?.phone).toBe("01099998888"); // 학생 레그만 생존
    expect(legs[0]?.studentId).toBe("s1");
  });

  it("학생 번호가 수신거부면 학생 레그만 제외, 학부모 레그는 생존", () => {
    const rows = [row("s1", "김학생", "01011112222", "01099998888")];
    const legs = expandRecipientLegs(rows, {
      sendToParent: true,
      sendToStudent: true,
      unsubscribedPhones: ["01099998888"], // 학생 번호 수신거부
    });
    expect(legs).toHaveLength(1);
    expect(legs[0]?.phone).toBe("01011112222"); // 학부모 레그만 생존
  });

  it("두 번호 모두 수신거부면 0레그", () => {
    const rows = [row("s1", "김학생", "01011112222", "01099998888")];
    const legs = expandRecipientLegs(rows, {
      sendToParent: true,
      sendToStudent: true,
      unsubscribedPhones: ["01011112222", "01099998888"],
    });
    expect(legs).toHaveLength(0);
  });

  it("수신거부 목록이 하이픈 포함이어도 정규화 후 매칭", () => {
    const rows = [row("s1", "김학생", "010-1111-2222", "01099998888")];
    const legs = expandRecipientLegs(rows, {
      sendToParent: true,
      sendToStudent: true,
      unsubscribedPhones: ["010-1111-2222"], // 하이픈 포함 수신거부
    });
    expect(legs).toHaveLength(1);
    expect(legs[0]?.phone).toBe("01099998888");
  });

  it("형제(같은 학부모 번호)가 모두 수신거부로 학부모 레그 제외돼도 각자 학생 레그 생존", () => {
    const rows = [
      row("s1", "형", "01011112222", "01010001000"),
      row("s2", "동생", "01011112222", "01020002000"),
    ];
    const legs = expandRecipientLegs(rows, {
      sendToParent: true,
      sendToStudent: true,
      unsubscribedPhones: ["01011112222"], // 공유 학부모 번호 수신거부
    });
    // 학부모 레그 2개 모두 제외, 학생 레그 2개 생존.
    expect(legs.map((l) => l.phone)).toEqual(["01010001000", "01020002000"]);
  });
});

describe("expandRecipientLegs · 번호 정규화", () => {
  it("하이픈 포함 입력번호를 \\D 제거해 phone 에 담는다", () => {
    const rows = [row("s1", "김학생", "010-1111-2222", "010.9999.8888")];
    const legs = expandRecipientLegs(rows, {
      sendToParent: true,
      sendToStudent: true,
    });
    expect(legs.map((l) => l.phone)).toEqual(["01011112222", "01099998888"]);
  });

  it("공백·괄호 등 비숫자 문자가 섞여도 숫자만 남긴다", () => {
    const rows = [row("s1", "김학생", " (010) 1111 2222 ", null)];
    const legs = expandRecipientLegs(rows, {
      sendToParent: true,
      sendToStudent: false,
    });
    expect(legs[0]?.phone).toBe("01011112222");
  });
});

describe("expandRecipientLegs · 경계값", () => {
  it("빈 rows → 빈 레그", () => {
    expect(
      expandRecipientLegs([], { sendToParent: true, sendToStudent: true }),
    ).toEqual([]);
  });

  it("레그에 status 동봉 (후속 가드 안전용)", () => {
    const rows = [row("s1", "김학생", "01011112222", null, "수강이력자")];
    const legs = expandRecipientLegs(rows, {
      sendToParent: true,
      sendToStudent: false,
    });
    expect(legs[0]?.status).toBe("수강이력자");
  });

  it("unsubscribedPhones 미주입(undefined)이면 수신거부 필터 미적용", () => {
    const rows = [row("s1", "김학생", "01011112222", "01099998888")];
    const legs = expandRecipientLegs(rows, {
      sendToParent: true,
      sendToStudent: true,
    });
    expect(legs).toHaveLength(2);
  });
});

describe("countDistinctStudents · 고유 학생 수", () => {
  it("2레그 학생도 1명으로 센다", () => {
    const legs = [
      { studentId: "s1" },
      { studentId: "s1" }, // 같은 학생 2레그
      { studentId: "s2" },
    ];
    expect(countDistinctStudents(legs)).toBe(2);
  });

  it("레그 0개 학생은 자연히 제외 (입력에 없으므로 세지 않음)", () => {
    // s3 는 번호가 없어 레그가 0개 → 아래 입력에 등장하지 않는다.
    const legs = [{ studentId: "s1" }, { studentId: "s2" }];
    expect(countDistinctStudents(legs)).toBe(2);
  });

  it("빈 입력 → 0", () => {
    expect(countDistinctStudents([])).toBe(0);
  });

  it("studentId null 은 각각 1명으로 계수", () => {
    const legs = [
      { studentId: null },
      { studentId: null },
      { studentId: "s1" },
    ];
    expect(countDistinctStudents(legs)).toBe(3);
  });

  it("expandRecipientLegs 출력과 연동 — 레그 생성된 고유 학생 수와 일치", () => {
    const rows = [
      row("s1", "둘다", "01011110000", "01022220000"), // 2레그
      row("s2", "학부모만", "01033330000", null), // 1레그
      row("s3", "둘다없음", null, null), // 0레그 → 제외
    ];
    const legs = expandRecipientLegs(rows, {
      sendToParent: true,
      sendToStudent: true,
    });
    // 레그 1개 이상 생성된 학생: s1, s2 = 2명. (s3 제외)
    expect(countDistinctStudents(legs)).toBe(2);
    // 불변식: legs(3) >= targetStudents(2)
    expect(legs.length).toBeGreaterThanOrEqual(countDistinctStudents(legs));
  });
});
