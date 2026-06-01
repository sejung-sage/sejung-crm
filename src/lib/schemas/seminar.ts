/**
 * 설명회 신청 시스템 (Phase 1) · Zod 스키마
 *
 * 0080 마이그(`crm_seminars`, `crm_seminar_signups`) 와 1:1 대응.
 *
 * 사용처:
 *  - 운영자 페이지(`/seminars`, `/seminars/new`, `/seminars/[id]`) Server Action 입력.
 *  - 학부모 공개 페이지(`/s/[token]`) 신청 폼 입력.
 *
 * DB 컬럼은 영어 snake_case, UI/에러 메시지는 한글.
 */

import { z } from "zod";

// ─── enum (DB CHECK 와 1:1) ────────────────────────────────────

export const SeminarStatusSchema = z.enum(["open", "closed", "ended", "cancelled"]);
export type SeminarStatus = z.infer<typeof SeminarStatusSchema>;

export const SignupStatusSchema = z.enum(["signed", "cancelled"]);
export type SignupStatus = z.infer<typeof SignupStatusSchema>;

/**
 * signup_for_seminar RPC 반환 status 의 enum.
 * 호출부가 switch 로 분기할 수 있도록 단일 소스로 export.
 */
export const SignupForSeminarStatusSchema = z.enum([
  "signed",
  "duplicate",
  "closed",
  "ended",
  "cancelled",
  "invalid",
  "out_of_window",
]);
export type SignupForSeminarStatus = z.infer<typeof SignupForSeminarStatusSchema>;

// ─── 공통 술어 ────────────────────────────────────────────────

/**
 * 한국 휴대폰 번호 정규화 + 검증.
 * 입력 형태 무관(하이픈/공백/+82 모두 허용) — digits 만 추출 후 길이 8~11 검사.
 *
 * 반환은 normalize 된 숫자만 문자열. RPC 가 동일 정규화를 다시 수행하므로
 * 클라이언트 측 정규화가 누락되어도 안전.
 */
export const ParentPhoneSchema = z
  .string()
  .trim()
  .transform((raw) => raw.replace(/[^0-9]/g, ""))
  .pipe(
    z
      .string()
      .min(8, "학부모 연락처가 너무 짧습니다")
      .max(11, "학부모 연락처가 너무 깁니다")
      .regex(/^\d+$/, "숫자만 입력해 주세요"),
  );

/**
 * 학생 이름 정규화 + 검증.
 * trim 후 1~40자. 빈 문자열은 RPC 가 'invalid' 반환하므로 폼에서 차단.
 */
export const StudentNameSchema = z
  .string()
  .trim()
  .min(1, "학생 이름을 입력해 주세요")
  .max(40, "학생 이름은 40자 이내로 입력하세요");

// ─── 운영자 입력 ──────────────────────────────────────────────

/**
 * 설명회 생성 입력 (운영자).
 *
 * link_token 은 서버가 nanoid(12) 로 생성하므로 입력에 포함하지 않는다.
 * status 도 기본 'open' 으로 시작 — 생성 시점에 다른 상태로 만들지 않는다.
 *
 * 날짜는 datetime-local 문자열 또는 ISO 문자열 모두 허용 — 서버에서 timestamptz
 * 캐스팅. 빈 문자열은 null 로 변환(폼 UX).
 */
const NullableDateTimeSchema = z
  .union([z.string().trim(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const t = v.trim();
    return t === "" ? null : t;
  })
  .pipe(z.string().nullable());

export const CreateSeminarInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "설명회 제목은 필수입니다")
      .max(80, "설명회 제목은 80자 이내로 입력하세요"),
    branch: z
      .string()
      .trim()
      .min(1, "분원은 필수입니다")
      .max(20, "분원명은 20자 이내로 입력하세요"),
    description: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((v) => {
        if (v === null || v === undefined) return null;
        const t = v.trim();
        return t === "" ? null : t;
      })
      .pipe(z.string().max(2000, "안내문은 2000자 이내로 입력하세요").nullable()),
    held_at: NullableDateTimeSchema,
    venue: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((v) => {
        if (v === null || v === undefined) return null;
        const t = v.trim();
        return t === "" ? null : t;
      })
      .pipe(z.string().max(80, "장소는 80자 이내로 입력하세요").nullable()),
    capacity: z
      .union([z.number(), z.null(), z.undefined()])
      .transform((v) => (v === undefined ? null : v))
      .pipe(
        z
          .number()
          .int("정원은 정수여야 합니다")
          .positive("정원은 1 이상이어야 합니다")
          .max(10000, "정원이 너무 큽니다")
          .nullable(),
      ),
    signup_opens_at: NullableDateTimeSchema,
    signup_closes_at: NullableDateTimeSchema,
  })
  .refine(
    (v) => {
      if (!v.signup_opens_at || !v.signup_closes_at) return true;
      return new Date(v.signup_opens_at) <= new Date(v.signup_closes_at);
    },
    {
      message: "신청 마감은 신청 시작 이후여야 합니다",
      path: ["signup_closes_at"],
    },
  );
export type CreateSeminarInput = z.infer<typeof CreateSeminarInputSchema>;

/**
 * 설명회 수정 입력 (운영자).
 *
 * `.refine` 가 걸린 스키마는 `.partial()` 을 못 쓰므로 base object 를 별도로 두고
 * 거기서 파생한다. signup window cross check 는 두 값이 모두 들어왔을 때만 수행.
 *
 * status 변경은 별도 액션(취소/종료 버튼)에서 처리하지만, 폼 일관성을 위해
 * 여기서도 허용한다. branch 변경은 RLS·분원 격리 정책상 금지.
 */
const UpdateSeminarBaseSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "설명회 제목은 필수입니다")
    .max(80, "설명회 제목은 80자 이내로 입력하세요"),
  description: z
    .union([z.string(), z.null()])
    .transform((v) => {
      if (v === null) return null;
      const t = v.trim();
      return t === "" ? null : t;
    })
    .pipe(z.string().max(2000).nullable()),
  held_at: NullableDateTimeSchema,
  venue: z
    .union([z.string(), z.null()])
    .transform((v) => {
      if (v === null) return null;
      const t = v.trim();
      return t === "" ? null : t;
    })
    .pipe(z.string().max(80).nullable()),
  capacity: z
    .union([z.number(), z.null()])
    .pipe(
      z
        .number()
        .int()
        .positive()
        .max(10000)
        .nullable(),
    ),
  signup_opens_at: NullableDateTimeSchema,
  signup_closes_at: NullableDateTimeSchema,
  status: SeminarStatusSchema,
});

export const UpdateSeminarInputSchema = UpdateSeminarBaseSchema.partial()
  .extend({ id: z.string().uuid("설명회 ID 가 유효하지 않습니다") })
  .refine(
    (v) => {
      if (!v.signup_opens_at || !v.signup_closes_at) return true;
      return new Date(v.signup_opens_at) <= new Date(v.signup_closes_at);
    },
    {
      message: "신청 마감은 신청 시작 이후여야 합니다",
      path: ["signup_closes_at"],
    },
  );
export type UpdateSeminarInput = z.infer<typeof UpdateSeminarInputSchema>;

// ─── 학부모 신청 입력 (anon) ──────────────────────────────────

/**
 * 학부모 설명회 신청 폼 입력.
 *
 * - student_name: trim 후 1~40자 (서버 RPC 가 같은 정규화 재수행)
 * - parent_phone: digits 정규화 후 8~11자
 * - consent     : 개인정보 수집·이용 동의(체크박스). 반드시 true.
 *
 * RPC `signup_for_seminar` 호출 시 student_name/parent_phone 만 전달.
 * consent 는 클라이언트 단 검증으로만 강제하고 DB 컬럼에는 저장 안 함.
 * (필요 시 Phase 2 에 동의 시각 저장 컬럼 추가)
 */
export const SubmitSignupInputSchema = z.object({
  student_name: StudentNameSchema,
  parent_phone: ParentPhoneSchema,
  consent: z.literal(true, {
    message: "개인정보 수집·이용에 동의해 주세요",
  }),
});
export type SubmitSignupInput = z.infer<typeof SubmitSignupInputSchema>;

// ─── 운영자 액션 보조 입력 ────────────────────────────────────

/**
 * 운영자 신청 취소 입력. soft delete (status='signed' → 'cancelled').
 */
export const CancelSignupInputSchema = z.object({
  signup_id: z.string().uuid("신청 ID 가 유효하지 않습니다"),
});
export type CancelSignupInput = z.infer<typeof CancelSignupInputSchema>;

/**
 * 운영자 설명회 상태 전이 입력 (취소/종료 버튼).
 * 'open'/'closed' 로의 되돌림은 정책상 비공개 — UI 가 노출하지 않으나
 * 스키마는 모든 enum 을 허용해 두어 미래 확장 여지를 남긴다.
 */
export const ChangeSeminarStatusInputSchema = z.object({
  seminar_id: z.string().uuid("설명회 ID 가 유효하지 않습니다"),
  status: SeminarStatusSchema,
});
export type ChangeSeminarStatusInput = z.infer<typeof ChangeSeminarStatusInputSchema>;

// ─── 리스트 검색 파라미터 ─────────────────────────────────────

/**
 * 운영자 설명회 리스트(/seminars) URL searchParams.
 *  - branch: 빈 문자열이면 전체 분원
 *  - status: 빈 문자열이면 전체 상태
 *  - q     : 제목 부분일치 검색
 */
export const SeminarListQuerySchema = z.object({
  branch: z.string().trim().optional().default(""),
  status: z
    .union([SeminarStatusSchema, z.literal("")])
    .optional()
    .default(""),
  q: z.string().trim().optional().default(""),
});
export type SeminarListQuery = z.infer<typeof SeminarListQuerySchema>;
