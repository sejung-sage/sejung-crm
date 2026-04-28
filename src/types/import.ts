/**
 * F1-03 CSV/XLSX Import 공통 타입
 *
 * 파싱/검증/적용 단계 간 계약(contract). 구체 파싱 로직은
 * src/lib/import/ 에서, Server Action 은 src/app/(features)/import/
 * 에서 각각 담당.
 */

export type ImportKind = "students" | "enrollments" | "attendances";

/**
 * 행 단위 검증 오류.
 * row 는 데이터 행 번호(1-based, 헤더 제외) 이며
 * CSV/엑셀 원본과 직접 매핑되어 사용자에게 보여지는 값이다.
 */
export type RowError = {
  row: number;
  field?: string;
  message: string;
  rawValue?: string;
};

/**
 * 단일 파일 검증 결과.
 * prepared 는 Zod output 의 union 이지만, 파일별로 의미가 달라
 * 본 공용 타입에서는 unknown[] 로 두고 호출측에서 좁힌다.
 */
export type ImportValidationReport = {
  kind: ImportKind;
  totalRows: number;
  validRows: number;
  errors: RowError[];
  prepared: unknown[];
};

/**
 * 3종 파일 통합 검증 결과.
 * crossErrors 는 파일 간 참조 무결성(예: 수강 이력의 학생이
 * students 파일에 없음) 실패를 담는다.
 */
export type ImportCombinedReport = {
  students: ImportValidationReport | null;
  enrollments: ImportValidationReport | null;
  attendances: ImportValidationReport | null;
  crossErrors: RowError[];
  summary: {
    totalStudents: number;
    totalEnrollments: number;
    totalAttendances: number;
    totalErrors: number;
    canCommit: boolean;
  };
};

/**
 * apply 단계 결과.
 * dev_seed_mode 는 로컬 dev-seed 데이터가 유지된 상태에서
 * 실 커밋을 막아야 할 때 사용.
 */
export type ImportApplyResult =
  | {
      status: "success";
      studentsUpserted: number;
      enrollmentsInserted: number;
      attendancesInserted: number;
    }
  | { status: "failed"; reason: string }
  | { status: "dev_seed_mode"; reason: string };
