import { z } from "zod";
import { TemplateTypeSchema } from "./common";

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

// ─── 1단계: 그룹 선택 ────────────────────────────────────────
export const ComposeStep1Schema = z.object({
  groupId: z.string().uuid("그룹을 선택하세요"),
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
    type: TemplateTypeSchema, // 'SMS' | 'LMS' | 'ALIMTALK'
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
  })
  .refine(
    (v) =>
      v.type === "SMS"
        ? true
        : v.subject !== null &&
          v.subject !== undefined &&
          v.subject.length > 0,
    { message: "LMS/알림톡은 제목이 필수입니다", path: ["subject"] },
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
  groupId: z.string().uuid("그룹을 선택하세요"),
  step2: ComposeStep2Schema,
});
export type PreviewInput = z.infer<typeof PreviewInputSchema>;
