import { describe, it, expect } from "vitest";
import {
  crossValidate,
  validateAttendances,
  validateEnrollments,
  validateStudents,
} from "@/lib/import/validate";

/**
 * F1-03 · Import 파일 간 교차 검증 테스트.
 *
 * - students 없이 수강/출석 만 올린 케이스
 * - students 내부 (parent_phone, name) 중복
 * - enrollments/attendances 의 학생 참조 실패
 * - 모든 케이스 정상 · canCommit === true
 */

describe("crossValidate · students 파일 필수", () => {
  it("students 없이 enrollments 만 있으면 crossErrors 발생", () => {
    const enrollments = validateEnrollments([
      {
        parent_phone: "01012345678",
        student_name: "김민준",
        course_name: "수학",
        amount: "100,000",
      },
    ]);
    const { combined } = crossValidate(null, enrollments, null);
    expect(combined.crossErrors.length).toBeGreaterThan(0);
    expect(
      combined.crossErrors.some((e) => e.message.includes("학생 파일")),
    ).toBe(true);
    expect(combined.summary.canCommit).toBe(false);
  });

  it("students 없이 attendances 만 있으면 crossErrors 발생", () => {
    const attendances = validateAttendances([
      {
        parent_phone: "01012345678",
        student_name: "김민준",
        attended_at: "2026-04-22",
        status: "출석",
      },
    ]);
    const { combined } = crossValidate(null, null, attendances);
    expect(combined.crossErrors.length).toBeGreaterThan(0);
    expect(combined.summary.canCommit).toBe(false);
  });

  it("빈 학생 파일 + 수강 파일 → 역시 학생 파일 필요", () => {
    const students = validateStudents([]);
    const enrollments = validateEnrollments([
      {
        parent_phone: "01012345678",
        student_name: "김민준",
        course_name: "수학",
        amount: 100000,
      },
    ]);
    const { combined } = crossValidate(students, enrollments, null);
    expect(
      combined.crossErrors.some((e) => e.message.includes("학생 파일")),
    ).toBe(true);
    expect(combined.summary.canCommit).toBe(false);
  });
});

describe("crossValidate · students 내부 중복", () => {
  it("(parent_phone, name) 중복 → crossErrors 에 중복 행 표시", () => {
    const students = validateStudents([
      {
        parent_phone: "01012345678",
        name: "김민준",
        branch: "대치",
      },
      {
        parent_phone: "01012345678",
        name: "김민준",
        branch: "대치",
      },
    ]);
    const { combined } = crossValidate(students, null, null);
    const dupErrors = combined.crossErrors.filter((e) =>
      e.message.includes("중복"),
    );
    // 중복 2행 모두 표시
    expect(dupErrors.length).toBe(2);
    expect(dupErrors.map((e) => e.row).sort()).toEqual([1, 2]);
    expect(combined.summary.canCommit).toBe(false);
  });

  it("(parent_phone, name) 조합이 다르면 중복 아님", () => {
    const students = validateStudents([
      {
        parent_phone: "01012345678",
        name: "김민준",
        branch: "대치",
      },
      {
        parent_phone: "01012345678",
        name: "김서윤",
        branch: "대치",
      },
    ]);
    const { combined } = crossValidate(students, null, null);
    expect(combined.crossErrors.filter((e) => e.message.includes("중복"))).toEqual(
      [],
    );
    expect(combined.summary.canCommit).toBe(true);
  });
});

describe("crossValidate · 참조 무결성", () => {
  it("enrollments 의 학생이 students 에 없음 → crossErrors", () => {
    const students = validateStudents([
      {
        parent_phone: "01012345678",
        name: "김민준",
        branch: "대치",
      },
    ]);
    const enrollments = validateEnrollments([
      {
        parent_phone: "01099998888",
        student_name: "박지후",
        course_name: "수학",
        amount: 500000,
      },
    ]);
    const { combined } = crossValidate(students, enrollments, null);
    const refErrors = combined.crossErrors.filter((e) =>
      e.message.includes("학생 매칭 실패"),
    );
    expect(refErrors.length).toBe(1);
    expect(refErrors[0].message).toContain("[수강 파일]");
    expect(combined.summary.canCommit).toBe(false);
  });

  it("attendances 의 학생이 students 에 없음 → crossErrors", () => {
    const students = validateStudents([
      {
        parent_phone: "01012345678",
        name: "김민준",
        branch: "대치",
      },
    ]);
    const attendances = validateAttendances([
      {
        parent_phone: "01099998888",
        student_name: "박지후",
        attended_at: "2026-04-22",
        status: "출석",
      },
    ]);
    const { combined } = crossValidate(students, null, attendances);
    const refErrors = combined.crossErrors.filter((e) =>
      e.message.includes("학생 매칭 실패"),
    );
    expect(refErrors.length).toBe(1);
    expect(refErrors[0].message).toContain("[출석 파일]");
    expect(combined.summary.canCommit).toBe(false);
  });

  it("참조가 모두 정상이면 crossErrors 는 참조 오류 없음", () => {
    const students = validateStudents([
      {
        parent_phone: "01012345678",
        name: "김민준",
        branch: "대치",
      },
    ]);
    const enrollments = validateEnrollments([
      {
        parent_phone: "010-1234-5678",
        student_name: "김민준",
        course_name: "수학",
        amount: 500000,
      },
    ]);
    const attendances = validateAttendances([
      {
        parent_phone: "01012345678",
        student_name: "김민준",
        attended_at: "2026-04-22",
        status: "출석",
      },
    ]);
    const { combined } = crossValidate(students, enrollments, attendances);
    expect(
      combined.crossErrors.filter((e) =>
        e.message.includes("학생 매칭 실패"),
      ),
    ).toEqual([]);
    expect(combined.summary.canCommit).toBe(true);
  });
});

describe("crossValidate · summary 계산", () => {
  it("모든 파일 정상 → canCommit === true", () => {
    const students = validateStudents([
      { parent_phone: "01012345678", name: "김민준", branch: "대치" },
      { parent_phone: "01012345679", name: "이서연", branch: "대치" },
    ]);
    const { combined } = crossValidate(students, null, null);
    expect(combined.summary.totalStudents).toBe(2);
    expect(combined.summary.totalErrors).toBe(0);
    expect(combined.summary.canCommit).toBe(true);
  });

  it("학생 파일에 Zod 에러 1건 → canCommit === false", () => {
    const students = validateStudents([
      { parent_phone: "01012345678", name: "김민준", branch: "대치" },
      // 전화 형식 오류
      { parent_phone: "bad", name: "이서연", branch: "대치" },
    ]);
    const { combined } = crossValidate(students, null, null);
    expect(combined.summary.totalErrors).toBeGreaterThan(0);
    expect(combined.summary.canCommit).toBe(false);
  });

  it("students 파일이 비어있으면 canCommit === false (children 없어도)", () => {
    const students = validateStudents([]);
    const { combined } = crossValidate(students, null, null);
    expect(combined.summary.totalStudents).toBe(0);
    expect(combined.summary.canCommit).toBe(false);
  });

  it("totalEnrollments / totalAttendances 집계", () => {
    const students = validateStudents([
      { parent_phone: "01012345678", name: "김민준", branch: "대치" },
    ]);
    const enrollments = validateEnrollments([
      {
        parent_phone: "01012345678",
        student_name: "김민준",
        course_name: "수학",
        amount: 100000,
      },
    ]);
    const attendances = validateAttendances([
      {
        parent_phone: "01012345678",
        student_name: "김민준",
        attended_at: "2026-04-22",
        status: "출석",
      },
      {
        parent_phone: "01012345678",
        student_name: "김민준",
        attended_at: "2026-04-23",
        status: "출석",
      },
    ]);
    const { combined } = crossValidate(students, enrollments, attendances);
    expect(combined.summary.totalStudents).toBe(1);
    expect(combined.summary.totalEnrollments).toBe(1);
    expect(combined.summary.totalAttendances).toBe(2);
    expect(combined.summary.canCommit).toBe(true);
  });
});
