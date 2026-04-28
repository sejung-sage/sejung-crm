import { z } from "zod";
import {
  AttendanceStatusSchema,
  GradeSchema,
  PhoneSchema,
  StudentStatusSchema,
  SubjectSchema,
  TrackSchema,
  type Grade,
} from "./common";

/**
 * F1-03 · CSV/XLSX Import 검증 스키마 모음
 *
 * 설계 원칙:
 *  - 파싱(파일 → 객체) 은 상위 모듈에서 수행. 본 파일은 "행 단위 객체" 를
 *    받아 도메인 타입으로 정규화/검증.
 *  - 한글 헤더("고1", "550,000" 등) 가 혼재하므로 Zod 진입 전 전처리 헬퍼로
 *    문자열을 표준형으로 맞춘다.
 *  - branch 는 분원 확장 여지를 위해 enum 체크하지 않고 trim 된 TEXT 로 수락.
 *
 * 0012 마이그레이션 반영:
 *  - students.grade 가 자유형식 TEXT → 9종 enum (중1~고3/재수/졸업/미정).
 *  - normalizeGrade(rawGrade, school) 는 DB 의 normalize_student_grade(...)
 *    함수와 동일 규칙. CSV 헤더는 기존 "학년" / "grade" 그대로 수용하되,
 *    값은 아카 원값 ("1"~"10"/"고3"/"졸"/NULL) 또는 정규화 enum 두 형태 모두 허용.
 */

// ============================================================
// 전처리 헬퍼 유틸
// ============================================================

/**
 * 빈 문자열/공백/undefined/null 을 모두 null 로.
 * 그 외 타입은 그대로 반환.
 */
export function emptyToNull(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  return v;
}

/**
 * 학교명이 중학교 suffix 인지 판정.
 * "○○중" 또는 "○○중학교" 로 끝나면 true.
 */
function isMiddleSchool(school: string | null | undefined): boolean {
  if (school === null || school === undefined) return false;
  const s = String(school).trim();
  if (s === "") return false;
  if (s.endsWith("중학교")) return true;
  // suffix '중' 1자: '휘문고' 와 충돌하지 않도록 마지막 1글자만 비교.
  return s.charAt(s.length - 1) === "중";
}

/**
 * CSV/Excel 가져오기에서 사용자 입력 grade 값을 정규화 9종 enum 으로 매핑.
 * DB 의 public.normalize_student_grade(grade_raw, school) 와 동일 규칙.
 *
 * 매핑표:
 *   '1'/'2'/'3'  + 학교 suffix '중' → 중1/중2/중3
 *   '1'/'2'/'3'  + 그 외             → 고1/고2/고3
 *   '4'                              → 재수
 *   '0'/'5'~'10'/'졸'                → 졸업
 *   '고3'                            → 고3
 *   '중1'~'중3'/'고1'~'고2'/'재수'/'졸업'/'미정' (이미 정규화된 값) → 그대로
 *   그 외 / NULL / 공백              → 미정 (방어적)
 *
 * 결과는 항상 Grade enum 9종 중 하나. null 반환 안 함 (DB CHECK 통과 보장).
 */
export function normalizeGrade(
  rawGrade: string | number | null | undefined,
  school: string | null | undefined,
): Grade {
  // NULL / undefined / 빈값 → 미정
  if (rawGrade === null || rawGrade === undefined) return "미정";
  const s = String(rawGrade).trim();
  if (s === "") return "미정";

  // 이미 정규화된 enum 값이면 그대로 통과 (재실행 idempotent).
  if (
    s === "중1" ||
    s === "중2" ||
    s === "중3" ||
    s === "고1" ||
    s === "고2" ||
    s === "고3" ||
    s === "재수" ||
    s === "졸업" ||
    s === "미정"
  ) {
    return s;
  }

  // 명시적 한글 표기
  if (s === "졸") return "졸업";

  // 정수 1/2/3 + 학교 suffix 로 중/고 분기
  if (s === "1") return isMiddleSchool(school) ? "중1" : "고1";
  if (s === "2") return isMiddleSchool(school) ? "중2" : "고2";
  if (s === "3") return isMiddleSchool(school) ? "중3" : "고3";

  // 4 = 재수
  if (s === "4") return "재수";

  // 0, 5~10 = 장기 재수 / 졸업과 통합
  if (
    s === "0" ||
    s === "5" ||
    s === "6" ||
    s === "7" ||
    s === "8" ||
    s === "9" ||
    s === "10"
  ) {
    return "졸업";
  }

  // 알 수 없는 값 → 방어적으로 미정
  return "미정";
}

/**
 * "550,000" / "550000" / 550000 / " ￦ 550,000 원 " → 550000.
 * 숫자 변환 실패 / 음수 / 빈값 → null.
 */
export function normalizeAmount(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    return Number.isFinite(input) && input >= 0 ? Math.trunc(input) : null;
  }
  if (typeof input !== "string") return null;
  const cleaned = input.replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

/**
 * 날짜를 YYYY-MM-DD 문자열로 정규화.
 * 허용 입력:
 *  - "YYYY-MM-DD" / "YYYY/MM/DD" / "YYYY.MM.DD"
 *  - Date 객체
 *  - 숫자 또는 숫자 문자열 → Excel date serial (1900-01-01 기준)
 *
 * Excel serial 주의: Excel 의 1900 윤년 버그로 인해 1900-03-01 이후 날짜는
 * 실제와 1일 차이가 없지만, 1900-02-29(존재하지 않는 날) 처리 관례에 맞춰
 * serial=25569 를 1970-01-01(UTC) 로 취급한다.
 */
export function normalizeDate(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return formatYmd(input);
  }

  // 숫자(또는 순수 숫자 문자열) → Excel serial
  if (
    typeof input === "number" ||
    (typeof input === "string" && /^-?\d+(\.\d+)?$/.test(input.trim()))
  ) {
    const serial = typeof input === "number" ? input : Number(input);
    if (!Number.isFinite(serial)) return null;
    // Excel epoch (Windows) 1899-12-30. 25569 → 1970-01-01
    const ms = Math.round((serial - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return formatYmd(d);
  }

  if (typeof input !== "string") return null;
  const s = input.trim();
  if (s === "") return null;

  // YYYY[-/.]MM[-/.]DD
  const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y.toString().padStart(4, "0")}-${mo
      .toString()
      .padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
  }

  // 마지막 시도: Date.parse
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return formatYmd(new Date(t));
}

function formatYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${day
    .toString()
    .padStart(2, "0")}`;
}

/**
 * 한국 휴대폰 번호 정규화.
 * 하이픈/공백/괄호 제거 후 10~11자리 숫자만 허용. 유효하지 않으면 null.
 * 반환 형식은 DB 저장 표준형(하이픈 없는 숫자열)으로 통일 —
 * `(parent_phone, name)` 복합 UNIQUE 인덱스 일치성 보장.
 */
export function normalizeKoreanPhone(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "string" && typeof input !== "number") return null;
  const raw = String(input);
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 11) return null;
  if (!/^01[016789]/.test(digits)) return null;
  return digits;
}

// ============================================================
// 공통 Zod 빌딩 블록
// ============================================================

/** 필수 전화번호: 전처리 후 PhoneSchema 검증. */
const RequiredPhone = z.preprocess(
  (v) => normalizeKoreanPhone(v) ?? v,
  PhoneSchema,
);

/** 선택 전화번호: 빈값 → null, 있으면 정규화 후 형식 검증. */
const OptionalPhone = z
  .preprocess((v) => {
    const e = emptyToNull(v);
    if (e === null) return null;
    return normalizeKoreanPhone(e);
  }, z.union([PhoneSchema, z.null()]))
  .nullable();

/** 선택 문자열 (빈값 → null, trim). */
const OptionalTrimString = (max: number) =>
  z
    .preprocess(
      (v) => {
        const e = emptyToNull(v);
        if (e === null) return null;
        if (typeof e !== "string") return String(e).trim();
        return e.trim();
      },
      z.union([z.string().max(max), z.null()]),
    )
    .nullable();

/** 필수 trim 문자열. */
const RequiredTrimString = (min: number, max: number, label: string) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().min(min, `${label} 은(는) 필수입니다`).max(max),
  );

/** 선택 날짜 (YYYY-MM-DD 문자열 or null). */
const OptionalDate = z
  .preprocess((v) => {
    const e = emptyToNull(v);
    if (e === null) return null;
    return normalizeDate(e);
  }, z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜 형식이 올바르지 않습니다"), z.null()]))
  .nullable();

/** 필수 날짜. */
const RequiredDate = z.preprocess(
  (v) => normalizeDate(v),
  z
    .string({ message: "날짜는 필수입니다" })
    .regex(/^\d{4}-\d{2}-\d{2}$/, "날짜 형식이 올바르지 않습니다"),
);

// ============================================================
// 1) ImportStudentRowSchema
//
// grade 정규화는 school 컨텍스트가 필요하므로 (예: '2' + 학교 suffix '중'
// → '중2') 단일 필드 preprocess 가 아니라 object 단위 transform 으로
// school 과 함께 normalizeGrade(rawGrade, school) 를 호출한다.
//
// 결과 타입의 grade 는 항상 Grade enum 9종 중 하나 (null 아님 — '미정'
// 으로 흡수). grade_raw 는 원본 문자열 보존 (DB grade_raw 컬럼에 그대로).
// ============================================================

/**
 * grade 입력의 원시 형태.
 * - 빈값/공백/null/undefined → null (정규화 시 '미정' 흡수)
 * - 문자열 → trim
 * - 숫자 → 문자열 변환 후 trim
 */
const RawGradeField = z
  .preprocess((v) => {
    const e = emptyToNull(v);
    if (e === null) return null;
    if (typeof e === "string") return e.trim();
    if (typeof e === "number") return String(e);
    return null;
  }, z.union([z.string(), z.null()]))
  .nullable();

export const ImportStudentRowSchema = z
  .object({
    parent_phone: RequiredPhone,
    name: RequiredTrimString(1, 20, "이름"),
    phone: OptionalPhone,
    school: OptionalTrimString(50),
    /** 사용자가 CSV/XLSX 에 적은 grade 원시 문자열. transform 단계에서 grade enum 으로 정규화. */
    grade: RawGradeField,
    track: z
      .preprocess((v) => {
        const e = emptyToNull(v);
        if (e === null) return null;
        if (typeof e === "string") return e.trim();
        return e;
      }, z.union([TrackSchema, z.null()]))
      .nullable(),
    status: z
      .preprocess((v) => {
        const e = emptyToNull(v);
        if (e === null) return "재원생";
        if (typeof e === "string") return e.trim();
        return e;
      }, StudentStatusSchema)
      .default("재원생"),
    branch: RequiredTrimString(1, 20, "분원"),
    registered_at: OptionalDate,
    aca2000_id: OptionalTrimString(50),
  })
  .transform((row) => {
    const rawGrade = row.grade; // string | null
    const grade = normalizeGrade(rawGrade, row.school);
    return {
      parent_phone: row.parent_phone,
      name: row.name,
      phone: row.phone,
      school: row.school,
      /** 정규화된 학년 (Grade enum 9종). DB students.grade 에 그대로 저장. */
      grade,
      /** 사용자 입력 원본 학년 문자열. DB students.grade_raw 에 저장. null 가능. */
      grade_raw: rawGrade,
      track: row.track,
      status: row.status,
      branch: row.branch,
      registered_at: row.registered_at,
      aca2000_id: row.aca2000_id,
    };
  })
  // transform 결과를 한 번 더 Grade enum 으로 검증 (정합성 보장).
  .pipe(
    z.object({
      parent_phone: z.string(),
      name: z.string(),
      phone: z.string().nullable(),
      school: z.string().nullable(),
      grade: GradeSchema,
      grade_raw: z.string().nullable(),
      track: TrackSchema.nullable(),
      status: StudentStatusSchema,
      branch: z.string(),
      registered_at: z.string().nullable(),
      aca2000_id: z.string().nullable(),
    }),
  );

export type ImportStudentRow = z.infer<typeof ImportStudentRowSchema>;

// ============================================================
// 2) ImportEnrollmentRowSchema
// ============================================================

export const ImportEnrollmentRowSchema = z.object({
  parent_phone: RequiredPhone,
  student_name: RequiredTrimString(1, 20, "학생 이름"),
  course_name: RequiredTrimString(1, 100, "강좌명"),
  teacher_name: OptionalTrimString(50),
  subject: z
    .preprocess((v) => {
      const e = emptyToNull(v);
      if (e === null) return null;
      if (typeof e === "string") return e.trim();
      return e;
    }, z.union([SubjectSchema, z.null()]))
    .nullable(),
  amount: z.preprocess(
    (v) => normalizeAmount(v),
    z
      .number({ message: "금액은 필수입니다" })
      .int("금액은 정수여야 합니다")
      .min(0, "금액은 0 이상이어야 합니다"),
  ),
  paid_at: OptionalDate,
  start_date: OptionalDate,
  end_date: OptionalDate,
});

export type ImportEnrollmentRow = z.infer<typeof ImportEnrollmentRowSchema>;

// ============================================================
// 3) ImportAttendanceRowSchema
// ============================================================

export const ImportAttendanceRowSchema = z.object({
  parent_phone: RequiredPhone,
  student_name: RequiredTrimString(1, 20, "학생 이름"),
  attended_at: RequiredDate,
  status: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    AttendanceStatusSchema,
  ),
  enrollment_course_name: OptionalTrimString(100),
});

export type ImportAttendanceRow = z.infer<typeof ImportAttendanceRowSchema>;
