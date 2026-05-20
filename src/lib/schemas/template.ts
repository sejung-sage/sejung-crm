import { z } from "zod";
import { TemplateTypeSchema } from "./common";

/**
 * 문자 템플릿(F3-A) Zod 스키마
 *
 * 사용자 확정 정책 (MVP · Phase 0):
 *  - 유형: SMS(단문 90b) / LMS(장문 2000b)
 *    → 0059 마이그에서 ALIMTALK 제거. 알림톡은 sendon.kakao + 사전 등록
 *      템플릿 ID 가 필요해 Phase 1 으로 보류.
 *  - LMS 는 제목 필수. SMS 는 제목 없음(있어도 무시).
 *  - 본문 바이트 한도는 저장 시점이 아닌 발송 시점에 최종 검증
 *    (본 스키마는 입력 길이만 최대치로 러프하게 제한).
 *  - is_ad 플래그로 광고성 여부 구분. 안전 가드 분기 기준.
 *  - 0059 마이그에서 teacher_name 컬럼 삭제 — 강사명 입력/필터 모두 제거.
 */

/**
 * sendon 기준 바이트 한도.
 */
export const BYTE_LIMITS = {
  SMS: 90,
  LMS: 2000,
} as const;

export type TemplateTypeLiteral = keyof typeof BYTE_LIMITS;

/**
 * 템플릿 생성 입력.
 * - name/body/type 필수
 * - subject 는 LMS 에서만 필수 (.refine 검사)
 * - is_ad 는 기본 false
 *
 * 0059 마이그 이후 type 은 SMS / LMS 만. teacher_name 필드는 폐지.
 */
export const CreateTemplateInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "템플릿명은 필수입니다")
      .max(40, "템플릿명은 40자 이내로 입력하세요"),
    type: TemplateTypeSchema,
    subject: z
      .string()
      .trim()
      .max(40, "제목은 40자 이내로 입력하세요")
      .optional()
      .nullable()
      .default(null),
    body: z
      .string()
      .trim()
      .min(1, "본문은 필수입니다")
      .max(4000, "본문이 너무 깁니다"),
    is_ad: z.boolean().default(false),
  })
  .refine(
    (v) =>
      v.type === "SMS"
        ? true
        : v.subject !== null &&
          v.subject !== undefined &&
          v.subject.length > 0,
    { message: "LMS 는 제목이 필수입니다", path: ["subject"] },
  );
export type CreateTemplateInput = z.infer<typeof CreateTemplateInputSchema>;

/**
 * 템플릿 수정 입력. id 필수 + 나머지는 생성과 동일.
 */
export const UpdateTemplateInputSchema = z
  .object({
    id: z.string().uuid("템플릿 ID 가 유효하지 않습니다"),
    name: z
      .string()
      .trim()
      .min(1, "템플릿명은 필수입니다")
      .max(40, "템플릿명은 40자 이내로 입력하세요"),
    type: TemplateTypeSchema,
    subject: z
      .string()
      .trim()
      .max(40, "제목은 40자 이내로 입력하세요")
      .optional()
      .nullable()
      .default(null),
    body: z
      .string()
      .trim()
      .min(1, "본문은 필수입니다")
      .max(4000, "본문이 너무 깁니다"),
    is_ad: z.boolean().default(false),
  })
  .refine(
    (v) =>
      v.type === "SMS"
        ? true
        : v.subject !== null &&
          v.subject !== undefined &&
          v.subject.length > 0,
    { message: "LMS 는 제목이 필수입니다", path: ["subject"] },
  );
export type UpdateTemplateInput = z.infer<typeof UpdateTemplateInputSchema>;

/**
 * 템플릿 리스트 화면 searchParams 검증 스키마.
 * - q: 템플릿명/본문 부분일치 (대소문자 무시, 구현은 backend)
 * - type: 유형 필터
 * - page: 1-base 페이지
 *
 * 0059 에서 teacher_name 필터 제거.
 */
export const TemplateListQuerySchema = z.object({
  q: z.string().trim().optional().default(""),
  type: z.enum(["SMS", "LMS"]).optional(),
  /** 분원 필터. 0055 분원 격리 도입 후 추가. master 만 다른 분원 지정 가능. */
  branch: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
});
export type TemplateListQuery = z.infer<typeof TemplateListQuerySchema>;
