import { z } from "zod";
import {
  AttendanceStatusSchema,
  PhoneSchema,
  StudentStatusSchema,
  SubjectSchema,
  TrackSchema,
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
 * "고1" / "고2" / "고3" / "1" / 1 → 1|2|3, 그 외 → null.
 */
export function normalizeGrade(input: unknown): 1 | 2 | 3 | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    return input === 1 || input === 2 || input === 3 ? input : null;
  }
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (s === "") return null;
  const m = s.match(/([123])/);
  if (!m) return null;
  const n = Number(m[1]);
  return n === 1 || n === 2 || n === 3 ? n : null;
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
// ============================================================

export const ImportStudentRowSchema = z.object({
  parent_phone: RequiredPhone,
  name: RequiredTrimString(1, 20, "이름"),
  phone: OptionalPhone,
  school: OptionalTrimString(50),
  grade: z
    .preprocess(
      (v) => {
        const e = emptyToNull(v);
        if (e === null) return null;
        return normalizeGrade(e);
      },
      z.union([z.literal(1), z.literal(2), z.literal(3), z.null()]),
    )
    .nullable(),
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
});

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
