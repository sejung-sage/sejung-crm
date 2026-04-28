import { describe, it, expect } from "vitest";
import {
  ImportAttendanceRowSchema,
  ImportEnrollmentRowSchema,
  ImportStudentRowSchema,
} from "@/lib/schemas/import";

/**
 * F1-03 · Import Zod 스키마 단위 테스트.
 * preprocess 전처리가 정상 동작하고 필수/선택/enum 제약이 기대대로
 * 실패 경로를 만드는지 확인.
 */

describe("ImportStudentRowSchema", () => {
  const baseRow = {
    parent_phone: "010-1234-5678",
    name: "김민준",
    branch: "대치",
  };

  it("정상 필수값만 있어도 통과 · status 기본 '재원생'", () => {
    const r = ImportStudentRowSchema.safeParse(baseRow);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.parent_phone).toBe("01012345678");
      expect(r.data.name).toBe("김민준");
      expect(r.data.branch).toBe("대치");
      expect(r.data.status).toBe("재원생");
      expect(r.data.grade).toBeNull();
      expect(r.data.track).toBeNull();
    }
  });

  it("parent_phone 빈값 → 실패 + path 에 parent_phone", () => {
    const r = ImportStudentRowSchema.safeParse({ ...baseRow, parent_phone: "" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path[0]);
      expect(paths).toContain("parent_phone");
    }
  });

  it("parent_phone 형식 오류 (02X) → 실패", () => {
    const r = ImportStudentRowSchema.safeParse({
      ...baseRow,
      parent_phone: "02-1234-5678",
    });
    expect(r.success).toBe(false);
  });

  it("name 길이 초과(21자) → 실패", () => {
    const longName = "가".repeat(21);
    const r = ImportStudentRowSchema.safeParse({ ...baseRow, name: longName });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path[0]);
      expect(paths).toContain("name");
    }
  });

  it("name 빈값 → 실패", () => {
    const r = ImportStudentRowSchema.safeParse({ ...baseRow, name: "   " });
    expect(r.success).toBe(false);
  });

  it("branch 빈값 → 실패", () => {
    const r = ImportStudentRowSchema.safeParse({ ...baseRow, branch: "" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path[0]);
      expect(paths).toContain("branch");
    }
  });

  it('grade "고3" → 3 으로 정규화', () => {
    const r = ImportStudentRowSchema.safeParse({ ...baseRow, grade: "고3" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.grade).toBe(3);
  });

  it('grade "고1" / "2" / 숫자 2 각각 정규화', () => {
    const a = ImportStudentRowSchema.safeParse({ ...baseRow, grade: "고1" });
    expect(a.success && a.data.grade).toBe(1);
    const b = ImportStudentRowSchema.safeParse({ ...baseRow, grade: "2" });
    expect(b.success && b.data.grade).toBe(2);
    const c = ImportStudentRowSchema.safeParse({ ...baseRow, grade: 2 });
    expect(c.success && c.data.grade).toBe(2);
  });

  it('grade "고4" → preprocess 에서 null 로 변환되어 통과 (nullable)', () => {
    // normalizeGrade 는 [123] 매칭 기반이라 "고4" 는 매칭 안되어 null 반환.
    // 스키마는 null 을 허용하므로 success.
    const r = ImportStudentRowSchema.safeParse({ ...baseRow, grade: "고4" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.grade).toBeNull();
  });

  it("grade 빈 문자열 → null", () => {
    const r = ImportStudentRowSchema.safeParse({ ...baseRow, grade: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.grade).toBeNull();
  });

  it('track "문과" / "이과" 통과', () => {
    const a = ImportStudentRowSchema.safeParse({ ...baseRow, track: "문과" });
    expect(a.success && a.data.track).toBe("문과");
    const b = ImportStudentRowSchema.safeParse({ ...baseRow, track: "이과" });
    expect(b.success && b.data.track).toBe("이과");
  });

  it('track "기타" → 실패', () => {
    const r = ImportStudentRowSchema.safeParse({ ...baseRow, track: "기타" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path[0]);
      expect(paths).toContain("track");
    }
  });

  it("track 빈값 → null 허용", () => {
    const r = ImportStudentRowSchema.safeParse({ ...baseRow, track: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.track).toBeNull();
  });

  it("status 빈값 → '재원생' 기본 적용", () => {
    const r = ImportStudentRowSchema.safeParse({ ...baseRow, status: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.status).toBe("재원생");
  });

  it('status "탈퇴" 직접 지정 통과', () => {
    const r = ImportStudentRowSchema.safeParse({ ...baseRow, status: "탈퇴" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.status).toBe("탈퇴");
  });

  it('status "휴원" 같은 비허용값 → 실패', () => {
    const r = ImportStudentRowSchema.safeParse({ ...baseRow, status: "휴원" });
    expect(r.success).toBe(false);
  });

  it("aca2000_id 빈 문자열 → null", () => {
    const r = ImportStudentRowSchema.safeParse({
      ...baseRow,
      aca2000_id: "",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.aca2000_id).toBeNull();
  });

  it("aca2000_id 값 → trim 된 문자열", () => {
    const r = ImportStudentRowSchema.safeParse({
      ...baseRow,
      aca2000_id: "  A-1234  ",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.aca2000_id).toBe("A-1234");
  });

  it("phone 선택값 정규화", () => {
    const r = ImportStudentRowSchema.safeParse({
      ...baseRow,
      phone: "010-9999-8888",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.phone).toBe("01099998888");
  });

  it("registered_at YYYY/MM/DD → YYYY-MM-DD", () => {
    const r = ImportStudentRowSchema.safeParse({
      ...baseRow,
      registered_at: "2026/03/02",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.registered_at).toBe("2026-03-02");
  });
});

describe("ImportEnrollmentRowSchema", () => {
  const baseRow = {
    parent_phone: "01012345678",
    student_name: "김민준",
    course_name: "고2 수학 내신반",
    amount: "550,000",
  };

  it("정상 행 통과 · amount 정규화", () => {
    const r = ImportEnrollmentRowSchema.safeParse(baseRow);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.amount).toBe(550000);
      expect(r.data.course_name).toBe("고2 수학 내신반");
      expect(r.data.subject).toBeNull();
    }
  });

  it("course_name 누락 → 실패", () => {
    const r = ImportEnrollmentRowSchema.safeParse({
      ...baseRow,
      course_name: "",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path[0]);
      expect(paths).toContain("course_name");
    }
  });

  it('amount "300,000" → 300000', () => {
    const r = ImportEnrollmentRowSchema.safeParse({
      ...baseRow,
      amount: "300,000",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.amount).toBe(300000);
  });

  it("amount 음수 → 실패", () => {
    const r = ImportEnrollmentRowSchema.safeParse({
      ...baseRow,
      amount: -100,
    });
    expect(r.success).toBe(false);
  });

  it("amount 비숫자 → 실패", () => {
    const r = ImportEnrollmentRowSchema.safeParse({
      ...baseRow,
      amount: "abc",
    });
    expect(r.success).toBe(false);
  });

  it('subject "수학" 통과', () => {
    const r = ImportEnrollmentRowSchema.safeParse({
      ...baseRow,
      subject: "수학",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.subject).toBe("수학");
  });

  it('subject "기타" → 실패', () => {
    const r = ImportEnrollmentRowSchema.safeParse({
      ...baseRow,
      subject: "기타",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path[0]);
      expect(paths).toContain("subject");
    }
  });

  it("subject 빈값 → null", () => {
    const r = ImportEnrollmentRowSchema.safeParse({ ...baseRow, subject: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.subject).toBeNull();
  });

  it("paid_at / start_date / end_date 선택값 정규화", () => {
    const r = ImportEnrollmentRowSchema.safeParse({
      ...baseRow,
      paid_at: "2026.03.02",
      start_date: "2026-03-02",
      end_date: "2026/06/30",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.paid_at).toBe("2026-03-02");
      expect(r.data.start_date).toBe("2026-03-02");
      expect(r.data.end_date).toBe("2026-06-30");
    }
  });

  it("parent_phone 누락 → 실패", () => {
    const r = ImportEnrollmentRowSchema.safeParse({
      ...baseRow,
      parent_phone: "",
    });
    expect(r.success).toBe(false);
  });
});

describe("ImportAttendanceRowSchema", () => {
  const baseRow = {
    parent_phone: "01012345678",
    student_name: "김민준",
    attended_at: "2026-04-22",
    status: "출석",
  };

  it("정상 행 통과", () => {
    const r = ImportAttendanceRowSchema.safeParse(baseRow);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.attended_at).toBe("2026-04-22");
      expect(r.data.status).toBe("출석");
    }
  });

  it("attended_at 누락 → 실패", () => {
    const r = ImportAttendanceRowSchema.safeParse({
      ...baseRow,
      attended_at: "",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path[0]);
      expect(paths).toContain("attended_at");
    }
  });

  it("status 빈값 → 실패", () => {
    const r = ImportAttendanceRowSchema.safeParse({ ...baseRow, status: "" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path[0]);
      expect(paths).toContain("status");
    }
  });

  it('status "병결" 같은 비허용값 → 실패', () => {
    const r = ImportAttendanceRowSchema.safeParse({
      ...baseRow,
      status: "병결",
    });
    expect(r.success).toBe(false);
  });

  it('status "지각" / "결석" / "조퇴" 통과', () => {
    for (const s of ["지각", "결석", "조퇴"]) {
      const r = ImportAttendanceRowSchema.safeParse({ ...baseRow, status: s });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.status).toBe(s);
    }
  });

  it("enrollment_course_name 선택값 · 빈값 → null", () => {
    const r = ImportAttendanceRowSchema.safeParse({
      ...baseRow,
      enrollment_course_name: "",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.enrollment_course_name).toBeNull();
  });

  it("attended_at Excel serial → YYYY-MM-DD 포맷", () => {
    const r = ImportAttendanceRowSchema.safeParse({
      ...baseRow,
      attended_at: 45017,
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.attended_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
