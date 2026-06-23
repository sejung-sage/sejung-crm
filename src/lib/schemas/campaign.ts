import { z } from "zod";
import { CampaignStatusSchema } from "./common";

/**
 * 발송 캠페인(F3-A 이력 조회) Zod 스키마
 *
 * Part A 스코프:
 *  - 캠페인 "리스트 조회" 쿼리 스키마만 정의.
 *  - 생성/예약/취소 스키마(CreateCampaignInput 등)는 Part B(/compose)에서 추가.
 */

/**
 * 캠페인 리스트 searchParams 검증.
 * - q: 캠페인 제목 또는 본문 부분일치 (title OR body ilike)
 * - teacher: 본문에 강사명 포함 (body ilike) — 운영팀이 강사명으로 발송이력 찾을 때
 * - klass: 본문에 강좌명/반명 포함 (body ilike)
 * - status: 캠페인 상태 필터
 * - from/to: 발송일(sent_at 또는 scheduled_at) 범위. YYYY-MM-DD
 * - sender: 발송자(created_by) UUID 정확 일치
 * - page: 1-base 페이지
 */
export const CampaignListQuerySchema = z.object({
  q: z.string().trim().optional().default(""),
  teacher: z.string().trim().optional().default(""),
  klass: z.string().trim().optional().default(""),
  status: CampaignStatusSchema.optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "날짜 형식이 YYYY-MM-DD 가 아닙니다")
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "날짜 형식이 YYYY-MM-DD 가 아닙니다")
    .optional(),
  sender: z.string().uuid("발송자 ID 가 유효하지 않습니다").optional(),
  /** 테스트 발송 필터. 'only'=테스트만, 'real'=실발송만, 미지정=전체. */
  test: z.enum(["only", "real"]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
});
export type CampaignListQuery = z.infer<typeof CampaignListQuerySchema>;
