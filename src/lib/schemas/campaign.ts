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
 * - q: 캠페인 제목 또는 템플릿명 부분일치 (실제 검색 범위는 backend)
 * - status: 캠페인 상태 필터
 * - from/to: 발송일(sent_at 또는 scheduled_at) 범위. YYYY-MM-DD
 * - page: 1-base 페이지
 */
export const CampaignListQuerySchema = z.object({
  q: z.string().trim().optional().default(""),
  status: CampaignStatusSchema.optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "날짜 형식이 YYYY-MM-DD 가 아닙니다")
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "날짜 형식이 YYYY-MM-DD 가 아닙니다")
    .optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
});
export type CampaignListQuery = z.infer<typeof CampaignListQuerySchema>;
