import { z } from "zod";
import { TemplateTypeSchema } from "./common";
import { GroupFiltersSchema } from "./group";
import { hasNameToken } from "@/lib/messaging/personalize";

/**
 * F3 Part B · Compose 4단계 위저드 Zod 스키마
 *
 * 흐름: 그룹 선택 → 템플릿 선택/직접 작성 → 미리보기·비용·테스트 발송 → 즉시/예약
 *
 * 정책 메모:
 *  - templateId 와 inline(직접 작성)은 동시에 둘 다 의미 있을 수 있음.
 *    템플릿을 베이스로 사용자가 본문을 수정한 경우, templateId 가 있더라도
 *    실제 발송은 step2 의 type/subject/body 를 진실 소스로 사용한다.
 *  - LMS/알림톡은 제목 필수. SMS 는 제목 없음.
 *  - 예약 발송: scheduleAt 만 저장하고 cron 실 실행은 Phase 1.
 *  - 테스트 발송: 본인 번호 1건. messages.is_test = TRUE 로 기록되어
 *    캠페인 통계에서 제외된다.
 */

// ─── 1단계: 필터로 직접 발송 (그룹 없이) ──────────────────────
/**
 * Phase 1: 발송 그룹(crm_groups) 없이 필터 조건으로 직접 발송한다.
 *  - filters: GroupFilters 재사용(학년/학교/과목/지역/상태 + 제외 + includeStudentIds).
 *             체크박스로 해제한 학생은 filters.excludeStudentIds 로 실어 보낸다.
 *  - branch : 발송 분원. 권한(can send)·수신자 분원 격리의 단일 소스.
 */
export const ComposeStep1Schema = z.object({
  filters: GroupFiltersSchema,
  branch: z
    .string()
    .trim()
    .min(1, "분원을 선택하세요")
    .max(20, "분원명은 20자 이내로 입력하세요"),
});
export type ComposeStep1 = z.infer<typeof ComposeStep1Schema>;

// ─── 2단계: 템플릿 선택 또는 직접 작성 ────────────────────────
/**
 * templateId 와 inline 둘 중 하나만 의미 있음.
 * 템플릿 베이스에서 사용자가 본문을 수정했을 수 있으므로
 * type/subject/body 는 항상 step2 의 값을 진실 소스로 사용.
 */
export const ComposeStep2Schema = z
  .object({
    templateId: z.string().uuid().optional(),
    // 0059 마이그 이후 'SMS' | 'LMS' 만. ALIMTALK 은 Phase 1.
    type: TemplateTypeSchema,
    subject: z
      .string()
      .trim()
      .max(40, "제목은 40자 이내로 입력하세요")
      .optional()
      .nullable(),
    body: z
      .string()
      .trim()
      .min(1, "본문은 필수입니다")
      .max(4000, "본문이 너무 깁니다"),
    isAd: z.boolean().default(false),
    /**
     * 동일번호 1회 발송(중복 번호 dedupe) 토글.
     * TRUE 면 같은 학부모 번호로 묶인 형제 N명을 1건으로 합쳐 발송한다.
     * isAd 와 같은 "발송 옵션" 토글로 step2 에 둔다.
     * {이름} 개인화 변수와는 상호배타 (아래 refine 에서 강제).
     */
    dedupeByPhone: z.boolean().default(false),
    /**
     * 발송 대상 — 학부모 대표번호(parent_phone)로 보낼지. 0077.
     * Aca2000 의 "학부모" 체크박스. 세정 운영 기본값 = TRUE.
     * sendToStudent 와 독립이며 둘 다 TRUE 면 한 학생이 학부모·학생 양쪽으로
     * 최대 2건 발송된다(레그 확장). 번호 없는 레그는 발송 시점에 스킵.
     */
    sendToParent: z.boolean().default(true),
    /**
     * 발송 대상 — 학생 개인번호(phone)로 보낼지. 0077.
     * Aca2000 의 "학생" 체크박스. 기본값 = FALSE.
     * sendToParent 와 독립. 둘 다 FALSE 는 아래 refine 으로 금지.
     */
    sendToStudent: z.boolean().default(false),
  })
  .refine(
    (v) =>
      v.type === "SMS"
        ? true
        : v.subject !== null &&
          v.subject !== undefined &&
          v.subject.length > 0,
    { message: "LMS/알림톡은 제목이 필수입니다", path: ["subject"] },
  )
  .refine(
    // 개인화({이름}) ↔ dedupe 상호배타.
    // 같은 번호로 형제 N명을 1건으로 합칠 때 누구 이름을 쓸지 결정 불가 →
    // 잘못된 이름 발송을 막기 위해 dedupe ON + 본문에 {이름} 동시 사용 금지.
    // {날짜} 는 전원 동일 값이라 충돌 없음 → 허용.
    (v) => !(v.dedupeByPhone && hasNameToken(v.body)),
    {
      message:
        "{이름} 변수가 포함된 본문은 동일번호 1회 발송과 함께 사용할 수 없습니다. 변수를 빼거나 동일번호 1회 발송을 끄세요.",
      path: ["dedupeByPhone"],
    },
  )
  .refine(
    // 발송 대상(학부모/학생) 최소 하나는 선택. 둘 다 끄면 발송 레그가 0개라
    // 무조건 "수신자 없음" 으로 끝난다. DB CHECK(chk_campaigns_send_target)가
    // 최종 방어선이지만 사용자에게는 여기서 한글로 즉시 안내한다.
    (v) => v.sendToParent || v.sendToStudent,
    {
      message: "발송 대상(학부모·학생) 중 최소 하나를 선택하세요",
      path: ["sendToParent"],
    },
  );
export type ComposeStep2 = z.infer<typeof ComposeStep2Schema>;

// ─── 3단계: 캠페인 메타 (제목) ───────────────────────────────
export const ComposeStep3Schema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "캠페인 제목은 필수입니다")
    .max(60, "캠페인 제목은 60자 이내로 입력하세요"),
});
export type ComposeStep3 = z.infer<typeof ComposeStep3Schema>;

// ─── 4단계 (최종): 즉시 vs 예약 ───────────────────────────────
/**
 * scheduleAt 미설정 → 즉시 발송.
 * 설정 시 ISO 8601 datetime 문자열. 실제 cron 실행은 Phase 1.
 */
export const ComposeFinalSchema = z.object({
  step1: ComposeStep1Schema,
  step2: ComposeStep2Schema,
  step3: ComposeStep3Schema,
  scheduleAt: z
    .string()
    .datetime({ message: "예약 시각 형식이 올바르지 않습니다" })
    .optional(),
});
export type ComposeFinal = z.infer<typeof ComposeFinalSchema>;

// ─── 테스트 발송 입력 ────────────────────────────────────────
/**
 * 본인 번호 1건만 허용. 발송 결과는 messages.is_test = TRUE 로 기록.
 */
export const TestSendInputSchema = z.object({
  step2: ComposeStep2Schema,
  toPhone: z
    .string()
    .regex(/^01[016789][0-9]{7,8}$/, "휴대폰 번호 형식이 올바르지 않습니다"),
});
export type TestSendInput = z.infer<typeof TestSendInputSchema>;

// ─── 미리보기 입력 ───────────────────────────────────────────
/**
 * 수신자 카운트·예상 비용·최종 본문 미리보기 산출용.
 * 가드 적용 후 본문([광고]/080 footer)과 야간 차단 여부도 함께 반환.
 */
export const PreviewInputSchema = z.object({
  step1: ComposeStep1Schema,
  step2: ComposeStep2Schema,
});
export type PreviewInput = z.infer<typeof PreviewInputSchema>;
