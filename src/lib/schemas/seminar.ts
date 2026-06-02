/**
 * 설명회 신청 시스템 · Zod 스키마
 *
 * 흐름 모델:
 *  - **현행(0082~)**: invitation 기반. 운영자가 (설명회 N × 학생 M) 매트릭스를
 *    만들어 학생당 토큰 1개로 발송. 학부모는 폼 입력 없이 카드 [신청하기]
 *    클릭 1회 = 신청 완료. RPC 2종 — `lookup_invitation_by_token`,
 *    `claim_invitation_item`. 새 스키마는 본 파일 하단 "현행 invitation"
 *    섹션 참조.
 *  - **폐기(0080·0081)**: 폼 기반 — 학부모가 학생 이름·전화 입력. 0082 에서
 *    DB RPC(`lookup_seminar_by_token` / `signup_for_seminar`) 및
 *    `crm_seminars.link_token` 컬럼이 DROP 되었다. 본 파일의 "폐기" 섹션
 *    스키마는 backward-compat 컴파일만을 위해 유지 — 실 실행 경로는 invitation
 *    스키마로 전부 옮긴다.
 *
 * 규약: DB 컬럼은 영어 snake_case, UI/에러 메시지는 한글.
 */

import { z } from "zod";

// ─── 설명회 enum (DB CHECK 와 1:1) ─────────────────────────────

export const SeminarStatusSchema = z.enum(["open", "closed", "ended", "cancelled"]);
export type SeminarStatus = z.infer<typeof SeminarStatusSchema>;

// ─── 현행 invitation 스키마 (0082) ────────────────────────────

/**
 * invitation_items.status enum (DB CHECK 와 1:1).
 *  - pending   : 미신청 기본
 *  - signed    : 학부모가 [신청하기] 클릭
 *  - cancelled : 운영자 취소 (soft delete)
 */
export const InvitationItemStatusSchema = z.enum([
  "pending",
  "signed",
  "cancelled",
]);
export type InvitationItemStatus = z.infer<typeof InvitationItemStatusSchema>;

/**
 * claim_invitation_item RPC 반환 status enum.
 *  - signed         : 정상 접수
 *  - already_signed : 멱등 (이미 signed — 재클릭 무해)
 *  - closed         : 정원 마감
 *  - ended          : 행사 종료
 *  - cancelled      : 설명회·카드 취소
 *  - invalid        : 토큰 또는 매핑 오류
 *  - out_of_window  : 신청 창 밖
 */
export const ClaimInvitationStatusSchema = z.enum([
  "signed",
  "already_signed",
  "closed",
  "ended",
  "cancelled",
  "invalid",
  "out_of_window",
]);
export type ClaimInvitationStatus = z.infer<typeof ClaimInvitationStatusSchema>;

/**
 * 발송 액션(=invitation 일괄 생성 + SMS 발송) 입력.
 *
 * 단순화: 학생 id 배열로 직접 받는다. (그룹 기반 → 학생 id 펼침은 호출부 책임)
 * branch 는 RLS 격리 — admin 은 본인 분원 강제, master 는 사이드바 선택값.
 */
export const CreateBroadcastInputSchema = z
  .object({
    seminar_ids: z
      .array(z.string().uuid("설명회 ID 가 유효하지 않습니다"))
      .min(1, "설명회를 1개 이상 선택해 주세요"),
    student_ids: z
      .array(z.string().uuid("학생 ID 가 유효하지 않습니다"))
      .min(1, "발송 대상 학생을 1명 이상 선택해 주세요"),
    body: z.string().trim().min(1, "본문은 필수입니다"),
    subject: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((v) => {
        if (v === null || v === undefined) return null;
        const t = v.trim();
        return t === "" ? null : t;
      })
      .pipe(z.string().max(120, "제목은 120자 이내로 입력하세요").nullable()),
    type: z.enum(["SMS", "LMS"]),
    branch: z
      .string()
      .trim()
      .min(1, "분원은 필수입니다")
      .max(20, "분원명은 20자 이내로 입력하세요"),
    /**
     * 광고성 문자 여부.
     *  - true  → `(광고)` prefix 자동 부착 + `무료수신거부 080-XXXX` footer 자동 부착
     *           + 21:00~08:00 KST 발송 차단.
     *  - false → 정보성. 가공 없이 원문 그대로 발송 (기본값).
     *
     * 기본 false 인 이유: 설명회 안내는 대개 정보성. 운영자가 LMS 장문 등에서
     * 광고성 컨텐츠를 섞을 때만 명시적으로 토글한다. UI(step3)는 호출 시 명시 전달.
     */
    is_ad: z.boolean().default(false),
    /**
     * 광고 footer 학원명 (`무료수신거부 ...` 앞에 부착될 학원 표기).
     *
     * 현재 가드 헬퍼는 학원명을 footer 에 자동 삽입하지 않지만(`무료수신거부 080-XXXX`
     * 한 줄만 추가), 향후 확장 위해 옵션으로 받아둔다. 호출자가 본문 자체에 학원명을
     * 박는 경우엔 미사용.
     */
    academy_name: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((v) => {
        if (v === null || v === undefined) return null;
        const t = v.trim();
        return t === "" ? null : t;
      })
      .pipe(z.string().max(20, "학원명은 20자 이내로 입력하세요").nullable())
      .optional(),
    /**
     * 무료수신거부 080 번호 override.
     *  - 비어 있으면 env `SMS_OPT_OUT_NUMBER` 사용
     *  - env 도 없으면 가드 헬퍼 기본값 (`080-123-4567`).
     */
    optout_phone: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((v) => {
        if (v === null || v === undefined) return null;
        const t = v.trim();
        return t === "" ? null : t;
      })
      .pipe(
        z
          .string()
          .max(20, "수신거부 번호는 20자 이내로 입력하세요")
          .nullable(),
      )
      .optional(),
  })
  .refine(
    (v) => {
      // LMS 는 subject 필수.
      if (v.type === "LMS" && v.subject === null) return false;
      return true;
    },
    { message: "LMS 발송은 제목이 필요합니다", path: ["subject"] },
  );
export type CreateBroadcastInput = z.infer<typeof CreateBroadcastInputSchema>;

/**
 * claim_invitation_item RPC 입력 (학부모 카드 [신청하기] 클릭).
 * Server Action 이 토큰을 URL 파라미터에서 받고 seminar_id 는 form data 에서.
 */
export const ClaimInvitationItemInputSchema = z.object({
  token: z.string().trim().min(1, "유효하지 않은 링크입니다"),
  seminar_id: z.string().uuid("설명회 ID 가 유효하지 않습니다"),
});
export type ClaimInvitationItemInput = z.infer<
  typeof ClaimInvitationItemInputSchema
>;

// ─── 운영자 입력 (설명회 마스터 CRUD — 변경 없음) ─────────────

/**
 * 설명회 생성 입력.
 *
 * link_token 컬럼이 0082 에서 DROP 되었으므로 더 이상 토큰 생성이 필요 없다.
 * 학생 페이지 토큰은 invitation 단위(crm_seminar_invitations.link_token)에서 생성.
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

/**
 * 운영자 설명회 상태 전이 (취소/종료 버튼).
 */
export const ChangeSeminarStatusInputSchema = z.object({
  seminar_id: z.string().uuid("설명회 ID 가 유효하지 않습니다"),
  status: SeminarStatusSchema,
});
export type ChangeSeminarStatusInput = z.infer<typeof ChangeSeminarStatusInputSchema>;

/**
 * 운영자 설명회 리스트(/seminars) URL searchParams.
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

// ─── 폐기 (0080·0081 폼 모델) — 백워드 컴파일용만 유지 ──────────
//
// 아래 enum/스키마는 실제 실행 경로에서 더 이상 사용되지 않는다.
// 0082 마이그가 DB RPC 2개와 `crm_seminars.link_token` 컬럼을 DROP 했고,
// 학부모 입력 폼은 invitation 모델로 대체되었다. 기존 호출처
// (parent-signup-flow, seminars/actions submitSignupAction 등)의 컴파일
// 그린을 위해 시그니처만 보존한다. 신규 코드에서는 사용하지 말 것.
//
// 추가 정리는 frontend/backend 가 invitation 흐름으로 옮긴 뒤 별도 PR.

/**
 * @deprecated 0080 폼 모델 신청 status (RPC `signup_for_seminar` 반환).
 * 새 흐름에선 `ClaimInvitationStatusSchema` 사용.
 */
export const SignupStatusSchema = z.enum(["signed", "cancelled"]);
/** @deprecated 위 enum 의 타입. */
export type SignupStatus = z.infer<typeof SignupStatusSchema>;

/**
 * @deprecated 0080 RPC `signup_for_seminar` 반환 status — 새 흐름 미사용.
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
/** @deprecated */
export type SignupForSeminarStatus = z.infer<typeof SignupForSeminarStatusSchema>;

/**
 * @deprecated 학부모 폼 입력. invitation 모델은 폼 입력 자체가 없다.
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

/** @deprecated 학부모 폼 입력. invitation 모델은 폼 입력 자체가 없다. */
export const StudentNameSchema = z
  .string()
  .trim()
  .min(1, "학생 이름을 입력해 주세요")
  .max(40, "학생 이름은 40자 이내로 입력하세요");

/**
 * @deprecated 학부모 신청 폼 입력 — 0082 에서 폼 자체가 사라졌다.
 * invitation 모델은 `ClaimInvitationItemInputSchema` 로 대체.
 */
export const SubmitSignupInputSchema = z.object({
  student_name: StudentNameSchema,
  parent_phone: ParentPhoneSchema,
  consent: z.literal(true, {
    message: "개인정보 수집·이용에 동의해 주세요",
  }),
});
/** @deprecated */
export type SubmitSignupInput = z.infer<typeof SubmitSignupInputSchema>;

/**
 * @deprecated 운영자 신청 취소 — 옛 `crm_seminar_signups.id` 기준.
 * invitation 모델의 카드 취소는 별도 액션(`cancelInvitationItem` 등) 으로 이관 예정.
 */
export const CancelSignupInputSchema = z.object({
  signup_id: z.string().uuid("신청 ID 가 유효하지 않습니다"),
});
/** @deprecated */
export type CancelSignupInput = z.infer<typeof CancelSignupInputSchema>;
