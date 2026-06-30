/**
 * 데이터 탐색기(/explorer) 전용 — 조회 가능한 데이터셋 화이트리스트 + 연산자 정의.
 *
 * ⚠️ 읽기 전용. 이 목록에 없는 테이블/뷰는 절대 조회되지 않는다(서버 액션이 화이트
 * 리스트로 강제). auth/메시징/시스템 테이블은 의도적으로 제외 — 학생 + aca_* raw
 * 계층만 노출한다.
 *
 * 컬럼은 하드코딩하지 않고 런타임에 introspect(샘플 1행 키) 한다 — ETL 로 컬럼이
 * 늘어도 자동 반영. 여기선 "어떤 테이블을 열 수 있는가"만 통제한다.
 */

export interface ExplorerDataset {
  /** 실제 테이블/뷰 이름 (public 스키마). */
  name: string;
  /** UI 라벨 (한글). */
  label: string;
  /** 간단 설명. */
  note: string;
}

export const EXPLORER_DATASETS: ReadonlyArray<ExplorerDataset> = [
  {
    name: "student_profiles",
    label: "학생 명단 (가공 뷰)",
    note: "이름·분원·학교·학년·재원상태·수강과목·출석률·누적결제 등 학생 단위 집계",
  },
  { name: "crm_students", label: "학생 (원본)", note: "crm_students 원본 행" },
  { name: "crm_classes", label: "강좌", note: "강좌 메타(과목·강사·분원)" },
  { name: "crm_enrollments", label: "수강 등록", note: "학생×강좌 등록" },
  { name: "crm_attendances", label: "출석", note: "출석 기록(방배 위주)" },
  {
    name: "aca_tickets",
    label: "수강권/회차 (raw)",
    note: "학생×수업일(회차) 단위 — 결제상태·used_at·금액 포함",
  },
  { name: "aca_payments", label: "결제 (raw)", note: "결제 내역" },
  { name: "aca_unpaid", label: "미납 (raw)", note: "미납 내역" },
  { name: "aca_teachers", label: "강사 (raw)", note: "강사 마스터" },
  {
    name: "aca_teacher_subjects",
    label: "강사-과목 (raw)",
    note: "강사별 담당 과목",
  },
  { name: "aca_class_accounts", label: "수강 계정 (raw)", note: "수강 계정" },
  { name: "aca_class_types", label: "강좌 유형 (raw)", note: "강좌 유형 코드" },
] as const;

const DATASET_NAME_SET: ReadonlySet<string> = new Set(
  EXPLORER_DATASETS.map((d) => d.name),
);

/** 데이터셋 이름이 화이트리스트에 있는지. 서버 액션의 1차 안전 가드. */
export function isAllowedDataset(name: string): boolean {
  return DATASET_NAME_SET.has(name);
}

/**
 * 필터 연산자 — PostgREST 메서드로 매핑(서버 액션). 값은 항상 파라미터로 전달돼
 * 인젝션 안전하고, 컬럼명은 introspect 한 실제 컬럼 집합으로 검증한다.
 */
export const EXPLORER_OPERATORS = [
  { value: "eq", label: "= 같음", needsValue: true },
  { value: "neq", label: "≠ 다름", needsValue: true },
  { value: "ilike", label: "∋ 포함", needsValue: true },
  { value: "gt", label: "> 초과", needsValue: true },
  { value: "gte", label: "≥ 이상", needsValue: true },
  { value: "lt", label: "< 미만", needsValue: true },
  { value: "lte", label: "≤ 이하", needsValue: true },
  { value: "in", label: "목록 중 (콤마)", needsValue: true },
  { value: "is_null", label: "비어있음", needsValue: false },
  { value: "not_null", label: "값 있음", needsValue: false },
] as const;

export type ExplorerOperator = (typeof EXPLORER_OPERATORS)[number]["value"];

const OPERATOR_SET: ReadonlySet<string> = new Set(
  EXPLORER_OPERATORS.map((o) => o.value),
);

export function isAllowedOperator(op: string): op is ExplorerOperator {
  return OPERATOR_SET.has(op);
}

/** 값 입력이 필요 없는 연산자(비어있음/값 있음). */
export function operatorNeedsValue(op: ExplorerOperator): boolean {
  return EXPLORER_OPERATORS.find((o) => o.value === op)?.needsValue ?? true;
}
