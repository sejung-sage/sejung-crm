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
 * claim_invitation_item / claim_signup_item RPC 반환 status enum.
 *  - signed         : 정상 접수
 *  - already_signed : 멱등 (이미 signed — 재클릭 무해)
 *  - limit_reached  : 중복 신청 불가(allow_multiple=false) 인데 이미 다른 카드 signed (0087)
 *  - closed         : 정원 마감
 *  - ended          : 행사 종료
 *  - cancelled      : 설명회·카드 취소
 *  - invalid        : 토큰 또는 매핑 오류
 *  - out_of_window  : 신청 창 밖
 */
export const ClaimInvitationStatusSchema = z.enum([
  "signed",
  "already_signed",
  "limit_reached",
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
    // 0084 새 모델: 강좌(crm_classes) 를 설명회의 단일 정체성으로 삼는다.
    // 발송 액션이 각 class_id 에 대해 crm_class_signup_pages 를 find-or-create.
    class_ids: z
      .array(z.string().uuid("강좌 ID 가 유효하지 않습니다"))
      .min(1, "설명회 강좌를 1개 이상 선택해 주세요"),
    /**
     * 발송 그룹 ID — 학생 목록을 client→server 로 왕복 전달하지 않고
     * 그룹만 받아 서버가 `loadAllGroupRecipients` 로 직접 펼친다.
     * (client 가 풀어서 `student_ids[]` 로 재전송하면 PostgREST `.in()` 의
     *  URL 길이 폭발로 Cloudflare 414 → predicate 방식으로 우회.)
     */
    group_id: z.string().uuid("발송 그룹 ID 가 유효하지 않습니다"),
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
     * 중복 신청 허용 여부 (0087).
     *  - true (기본) → 학부모가 invitation 내 여러 설명회 카드를 자유롭게 신청 가능(현행).
     *  - false       → 1개만 신청 가능. 이미 1개라도 signed 면 claim_signup_item 이
     *                  나머지 카드 신청을 'limit_reached' 로 차단.
     *
     * 발송 위저드의 "중복 신청 허용" 체크박스가 이 값을 결정하고, 발송 액션이
     * 생성하는 각 invitation 행의 allow_multiple 컬럼에 저장한다.
     */
    allow_multiple: z.boolean().default(true),
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
    /**
     * 예약 발송 시각 (ISO 8601). null/미지정이면 즉시 발송.
     * 지정 시 캠페인 scheduled_at 으로 적재 → drain 이 sendon reservation 으로 접수.
     * sendon 제약: 최소 30분 이후(서버 액션에서 검증).
     */
    scheduled_at: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((v) => {
        if (v === null || v === undefined) return null;
        const t = v.trim();
        return t === "" ? null : t;
      })
      .pipe(z.string().nullable())
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
 * claim_signup_item RPC 입력 (학부모 카드 [신청하기] 클릭).
 * 0085 새 RPC — 인자 의미는 동일하나 seminar_id → signup_page_id 로 변경.
 * Server Action 이 토큰을 URL 파라미터에서 받고 signup_page_id 는 form data 에서.
 */
export const ClaimInvitationItemInputSchema = z.object({
  token: z.string().trim().min(1, "유효하지 않은 링크입니다"),
  signup_page_id: z.string().uuid("신청 페이지 ID 가 유효하지 않습니다"),
});
export type ClaimInvitationItemInput = z.infer<
  typeof ClaimInvitationItemInputSchema
>;

/**
 * 강좌 상세에서 공개 신청 페이지 옵션 저장 (생성 or 갱신).
 * 0084 새 모델 — 강좌(crm_classes)당 페이지 1개(UNIQUE class_id).
 * 발송 액션이 자동 find-or-create 하지만, 운영자가 일정·정원·설명을 직접 조정할
 * 때 본 액션이 호출된다.
 */
export const UpsertClassSignupPageInputSchema = z
  .object({
    class_id: z.string().uuid("강좌 ID 가 유효하지 않습니다"),
    branch: z
      .string()
      .trim()
      .min(1, "분원은 필수입니다")
      .max(20, "분원명은 20자 이내로 입력하세요"),
    status: z.enum(["draft", "open", "closed"]),
    held_at: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((v) => {
        if (v === null || v === undefined) return null;
        const t = v.trim();
        return t === "" ? null : t;
      })
      .pipe(z.string().nullable()),
    signup_opens_at: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((v) => {
        if (v === null || v === undefined) return null;
        const t = v.trim();
        return t === "" ? null : t;
      })
      .pipe(z.string().nullable()),
    signup_closes_at: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((v) => {
        if (v === null || v === undefined) return null;
        const t = v.trim();
        return t === "" ? null : t;
      })
      .pipe(z.string().nullable()),
    description: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((v) => {
        if (v === null || v === undefined) return null;
        const t = v.trim();
        return t === "" ? null : t;
      })
      .pipe(z.string().max(2000, "설명은 2000자 이내").nullable()),
    capacity_override: z
      .union([z.number(), z.null(), z.undefined()])
      .transform((v) => (v === undefined ? null : v))
      .pipe(
        z
          .number()
          .int("정원은 정수여야 합니다")
          .positive("정원은 양수여야 합니다")
          .nullable(),
      ),
  })
  .refine(
    (v) => {
      // signup_opens_at <= signup_closes_at (DB CHECK 와 동일).
      if (!v.signup_opens_at || !v.signup_closes_at) return true;
      return v.signup_opens_at <= v.signup_closes_at;
    },
    {
      message: "신청 시작 시각이 마감 시각보다 늦을 수 없습니다",
      path: ["signup_closes_at"],
    },
  );
export type UpsertClassSignupPageInput = z.infer<
  typeof UpsertClassSignupPageInputSchema
>;

// ─── CRM 내부 설명회 생성 (아카 ETL 없이 운영자가 직접) ──────
//
// crm_classes 에 aca_class_id=NULL, subject='설명회' 로 INSERT 하고,
// 생성 직후 공개 신청 페이지(status='open')를 함께 만든다.
// 일시(held_at)·정원(capacity)·설명(description)은 선택.
export const CreateSeminarInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "설명회명은 필수입니다")
    .max(100, "설명회명은 100자 이내로 입력하세요"),
  branch: z
    .string()
    .trim()
    .min(1, "분원은 필수입니다")
    .max(20, "분원명은 20자 이내로 입력하세요"),
  held_at: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => {
      if (v === null || v === undefined) return null;
      const t = v.trim();
      return t === "" ? null : t;
    })
    .pipe(z.string().nullable()),
  capacity: z
    .union([z.number(), z.null(), z.undefined()])
    .transform((v) => (v === undefined ? null : v))
    .pipe(
      z
        .number()
        .int("정원은 정수여야 합니다")
        .positive("정원은 양수여야 합니다")
        .nullable(),
    ),
  description: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => {
      if (v === null || v === undefined) return null;
      const t = v.trim();
      return t === "" ? null : t;
    })
    .pipe(z.string().max(2000, "설명은 2000자 이내").nullable()),
});
export type CreateSeminarInput = z.infer<typeof CreateSeminarInputSchema>;

// ─── 운영자 — invitation 카드 단건 취소 (0084 새 모델) ─────

/**
 * 운영자가 신청 1건을 취소할 때 server action 이 받는 입력.
 *
 * `signup_id` 라는 이름은 backward-compat 으로 유지되지만, 의미상
 * `crm_class_signup_items.id` 다. cancelSignupAction 본체에서 사용.
 */
export const CancelSignupInputSchema = z.object({
  signup_id: z.string().uuid("신청 ID 가 유효하지 않습니다"),
});
export type CancelSignupInput = z.infer<typeof CancelSignupInputSchema>;
