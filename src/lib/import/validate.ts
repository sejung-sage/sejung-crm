/**
 * F1-03 · Import 행 단위 검증 + 파일 간 교차 검증
 *
 * parse-file.ts 가 뽑은 `ParsedRawRow[]` 를 받아 각 행을
 * `ImportStudentRowSchema` / `ImportEnrollmentRowSchema` / `ImportAttendanceRowSchema`
 * 에 통과시키고, 실패 행은 사용자 친화적 한글 메시지로 모은다.
 *
 * row 번호 규약:
 *  - 데이터 행 1-based (헤더 행 제외).
 *  - UI 에서 엑셀 행번호(2 이상)로 표시하려면 UI 쪽에서 +1 처리.
 */
import {
  ImportAttendanceRowSchema,
  ImportEnrollmentRowSchema,
  ImportStudentRowSchema,
  type ImportAttendanceRow,
  type ImportEnrollmentRow,
  type ImportStudentRow,
} from "@/lib/schemas/import";
import type {
  ImportCombinedReport,
  ImportKind,
  ImportValidationReport,
  RowError,
} from "@/types/import";
import type { ParsedRawRow } from "./parse-file";
import type { z } from "zod";

// ============================================================
// 한글 메시지 매핑
// ============================================================

/**
 * Zod 이슈 메시지를 사용자 친화 한글 메시지로 치환.
 * field 별로 커스텀 메시지가 있으면 우선 사용.
 */
const FIELD_LABELS: Record<string, string> = {
  parent_phone: "학부모 연락처",
  name: "학생 이름",
  student_name: "학생 이름",
  phone: "학생 연락처",
  school: "학교",
  grade: "학년",
  track: "계열",
  status: "상태",
  branch: "분원",
  registered_at: "등록일",
  aca2000_id: "아카2000 ID",
  course_name: "강좌명",
  teacher_name: "강사명",
  subject: "과목",
  amount: "금액",
  paid_at: "결제일",
  start_date: "개강일",
  end_date: "종강일",
  attended_at: "출석일",
  enrollment_course_name: "수강 강좌명",
};

const FIELD_MESSAGE_OVERRIDES: Record<
  string,
  (zodMessage: string, rawValue?: string) => string
> = {
  parent_phone: () => "학부모 연락처 형식이 올바르지 않습니다 (010-1234-5678)",
  phone: () => "학생 연락처 형식이 올바르지 않습니다 (010-1234-5678)",
  grade: () => "학년은 1, 2, 3 중 하나여야 합니다",
  track: () => "계열은 '문과' 또는 '이과' 만 가능합니다",
  status: (msg) => `상태값이 올바르지 않습니다: ${msg}`,
  subject: () => "과목은 수학/국어/영어/탐구 중 하나여야 합니다",
  amount: () => "금액은 0 이상의 정수여야 합니다",
  attended_at: () => "출석일은 필수이며 YYYY-MM-DD 형식이어야 합니다",
  registered_at: () => "등록일은 YYYY-MM-DD 형식이어야 합니다",
  paid_at: () => "결제일은 YYYY-MM-DD 형식이어야 합니다",
  start_date: () => "개강일은 YYYY-MM-DD 형식이어야 합니다",
  end_date: () => "종강일은 YYYY-MM-DD 형식이어야 합니다",
  branch: () => "분원은 필수입니다",
  name: (msg) => `학생 이름 ${msg}`,
  student_name: (msg) => `학생 이름 ${msg}`,
  course_name: (msg) => `강좌명 ${msg}`,
};

function humanizeIssue(
  field: string | undefined,
  zodMessage: string,
  rawValue?: string,
): string {
  if (!field) return zodMessage;
  const override = FIELD_MESSAGE_OVERRIDES[field];
  if (override) return override(zodMessage, rawValue);
  const label = FIELD_LABELS[field] ?? field;
  return `${label}: ${zodMessage}`;
}

// ============================================================
// 단일 행 검증 공통 루틴
// ============================================================

type AnyImportSchema =
  | typeof ImportStudentRowSchema
  | typeof ImportEnrollmentRowSchema
  | typeof ImportAttendanceRowSchema;

function validateRows<S extends AnyImportSchema>(
  kind: ImportKind,
  rows: ParsedRawRow[],
  schema: S,
): ImportValidationReport {
  const prepared: unknown[] = [];
  const errors: RowError[] = [];

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 1;
    const parsed = schema.safeParse(rows[i]);
    if (parsed.success) {
      prepared.push(parsed.data);
    } else {
      for (const issue of parsed.error.issues as z.core.$ZodIssue[]) {
        const field =
          issue.path.length > 0 && typeof issue.path[0] === "string"
            ? (issue.path[0] as string)
            : undefined;
        const rawValue = field
          ? safeStringifyCell((rows[i] as ParsedRawRow)[field])
          : undefined;
        errors.push({
          row: rowNum,
          field,
          message: humanizeIssue(field, issue.message, rawValue),
          rawValue,
        });
      }
    }
  }

  return {
    kind,
    totalRows: rows.length,
    validRows: prepared.length,
    errors,
    prepared,
  };
}

function safeStringifyCell(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return undefined;
  }
}

// ============================================================
// 퍼블릭 API · 파일별 검증
// ============================================================

export function validateStudents(rows: ParsedRawRow[]): ImportValidationReport {
  return validateRows("students", rows, ImportStudentRowSchema);
}

export function validateEnrollments(
  rows: ParsedRawRow[],
): ImportValidationReport {
  return validateRows("enrollments", rows, ImportEnrollmentRowSchema);
}

export function validateAttendances(
  rows: ParsedRawRow[],
): ImportValidationReport {
  return validateRows("attendances", rows, ImportAttendanceRowSchema);
}

// ============================================================
// 교차 검증
// ============================================================

/**
 * students prepared 내부 `(parent_phone, name)` 중복 검출.
 * 중복인 행들을 모두 crossErrors 로 표시.
 */
function findStudentDuplicates(
  studentsPrepared: ImportStudentRow[],
): RowError[] {
  const index = new Map<string, number[]>();
  studentsPrepared.forEach((s, i) => {
    const key = `${s.parent_phone}::${s.name}`;
    const bucket = index.get(key);
    if (bucket) bucket.push(i + 1);
    else index.set(key, [i + 1]);
  });

  const errors: RowError[] = [];
  for (const [key, rows] of index.entries()) {
    if (rows.length > 1) {
      const [phone, name] = key.split("::");
      for (const row of rows) {
        errors.push({
          row,
          field: "parent_phone",
          message: `학생 중복: ${phone} · ${name} · 같은 파일 내 ${rows.length}행에서 중복`,
        });
      }
    }
  }
  return errors;
}

/**
 * 수강/출석 파일의 (parent_phone, student_name) 이 students prepared 에 존재하는지 확인.
 */
function checkChildReferences(
  kind: "enrollments" | "attendances",
  childPrepared: Array<ImportEnrollmentRow | ImportAttendanceRow>,
  studentKeySet: Set<string>,
): RowError[] {
  const errors: RowError[] = [];
  for (let i = 0; i < childPrepared.length; i++) {
    const row = childPrepared[i];
    const key = `${row.parent_phone}::${row.student_name}`;
    if (!studentKeySet.has(key)) {
      errors.push({
        row: i + 1,
        field: "parent_phone",
        message: `학생 매칭 실패: ${row.parent_phone} · ${row.student_name} · 학생 파일에 동일 (학부모 연락처, 이름) 조합이 없습니다`,
      });
    }
  }
  return errors;
}

export function crossValidate(
  students: ImportValidationReport | null,
  enrollments: ImportValidationReport | null,
  attendances: ImportValidationReport | null,
): { combined: ImportCombinedReport } {
  const crossErrors: RowError[] = [];

  // 1) MVP 규약: students 파일은 필수. enrollments/attendances 만 업로드 불가.
  const hasStudents = !!students && students.totalRows > 0;
  const hasChild =
    (!!enrollments && enrollments.totalRows > 0) ||
    (!!attendances && attendances.totalRows > 0);

  if (!hasStudents && hasChild) {
    crossErrors.push({
      row: 0,
      field: undefined,
      message:
        "학생 파일 없이 수강/출석 파일만 업로드할 수 없습니다. 학생 파일을 먼저 업로드하세요",
    });
  }

  // 2) students 내부 중복
  const studentsPrepared =
    (students?.prepared as ImportStudentRow[] | undefined) ?? [];
  if (studentsPrepared.length > 0) {
    crossErrors.push(...findStudentDuplicates(studentsPrepared));
  }

  // 3) 자식 파일 → 학생 참조 무결성
  const studentKeySet = new Set<string>(
    studentsPrepared.map((s) => `${s.parent_phone}::${s.name}`),
  );

  if (enrollments && studentsPrepared.length > 0) {
    const enrPrepared = enrollments.prepared as ImportEnrollmentRow[];
    const enrRefErrors = checkChildReferences(
      "enrollments",
      enrPrepared,
      studentKeySet,
    );
    // kind 표기를 위해 별도 라벨 붙이기
    for (const e of enrRefErrors) {
      crossErrors.push({ ...e, message: `[수강 파일] ${e.message}` });
    }
  }

  if (attendances && studentsPrepared.length > 0) {
    const attPrepared = attendances.prepared as ImportAttendanceRow[];
    const attRefErrors = checkChildReferences(
      "attendances",
      attPrepared,
      studentKeySet,
    );
    for (const e of attRefErrors) {
      crossErrors.push({ ...e, message: `[출석 파일] ${e.message}` });
    }
  }

  const totalStudents = students?.totalRows ?? 0;
  const totalEnrollments = enrollments?.totalRows ?? 0;
  const totalAttendances = attendances?.totalRows ?? 0;
  const fileErrors =
    (students?.errors.length ?? 0) +
    (enrollments?.errors.length ?? 0) +
    (attendances?.errors.length ?? 0);
  const totalErrors = fileErrors + crossErrors.length;

  const canCommit =
    totalErrors === 0 && hasStudents && (students?.validRows ?? 0) > 0;

  const combined: ImportCombinedReport = {
    students,
    enrollments,
    attendances,
    crossErrors,
    summary: {
      totalStudents,
      totalEnrollments,
      totalAttendances,
      totalErrors,
      canCommit,
    },
  };

  return { combined };
}
