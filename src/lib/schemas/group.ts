import { z } from "zod";
import { SubjectSchema } from "./common";

/**
 * 발송 그룹(F2) Zod 스키마
 *
 * 사용자 확정 정책 (MVP · Phase 0):
 *  - 필터는 학년 · 학교 · 과목 3개만. 교사·상태·기간 필터는 Phase 1.
 *  - 그룹은 동적: `filters` 를 저장하고 발송 시점에 재조회하여 수신자 산정.
 *  - 자동 제외는 "비활성(탈퇴) + 수신거부" 만. "최근 3회 수신자 제외" 는 Phase 1.
 *
 * DB 컬럼은 영어 snake_case, UI 라벨은 한글. 에러 메시지는 전부 한글.
 */

/**
 * groups.filters (JSONB) 의 정규 구조.
 * 모든 필드는 선택이며, 빈 배열은 "조건 없음(전체 허용)" 의미.
 */
export const GroupFiltersSchema = z.object({
  /** 학년: 1/2/3 중 다중 선택. 빈 배열이면 전 학년 */
  grades: z
    .array(z.union([z.literal(1), z.literal(2), z.literal(3)]))
    .default([]),
  /** 학교명: 자유 입력 문자열 배열. 빈 배열이면 전 학교 */
  schools: z.array(z.string().trim().min(1).max(40)).default([]),
  /** 과목: 공통 SubjectSchema 재사용. 빈 배열이면 전 과목 */
  subjects: z.array(SubjectSchema).default([]),
});
export type GroupFilters = z.infer<typeof GroupFiltersSchema>;

/**
 * 그룹 생성 입력.
 * - name/branch 는 필수
 * - filters 는 비어 있어도 유효(=전체)
 */
export const CreateGroupInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "그룹명은 필수입니다")
    .max(40, "그룹명은 40자 이내로 입력하세요"),
  branch: z
    .string()
    .trim()
    .min(1, "분원은 필수입니다")
    .max(20, "분원명은 20자 이내로 입력하세요"),
  filters: GroupFiltersSchema,
});
export type CreateGroupInput = z.infer<typeof CreateGroupInputSchema>;

/**
 * 그룹 수정 입력. 부분 변경 허용.
 * id 는 UUID 문자열.
 */
export const UpdateGroupInputSchema = CreateGroupInputSchema.partial().extend({
  id: z.string().uuid("그룹 ID 가 유효하지 않습니다"),
});
export type UpdateGroupInput = z.infer<typeof UpdateGroupInputSchema>;

/**
 * 그룹 리스트 화면 searchParams 검증 스키마.
 * - q: 그룹명 부분일치 검색
 * - branch: 분원 필터 (빈 문자열이면 전체 분원)
 * - page: 1-base 페이지 번호
 */
export const GroupListQuerySchema = z.object({
  q: z.string().trim().optional().default(""),
  branch: z.string().trim().optional().default(""),
  page: z.coerce.number().int().min(1).optional().default(1),
});
export type GroupListQuery = z.infer<typeof GroupListQuerySchema>;
