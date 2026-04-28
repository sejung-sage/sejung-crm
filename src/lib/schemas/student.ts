import { z } from "zod";
import {
  BranchSchema,
  GradeSchema,
  PhoneSchema,
  StudentStatusSchema,
  TrackSchema,
} from "./common";

/**
 * 학생 검색·필터·페이지네이션 입력 스키마.
 * 학생 목록 Server Action 의 입력 검증용.
 */
export const ListStudentsInputSchema = z.object({
  search: z.string().trim().max(100).optional().default(""),
  branch: z.string().optional(), // 비어있으면 "전체 분원"
  grades: z.array(GradeSchema).optional().default([]),
  tracks: z.array(TrackSchema).optional().default([]),
  statuses: z.array(StudentStatusSchema).optional().default([]),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  // 정렬은 MVP에서 기본 최신 등록 순만 지원
});

export type ListStudentsInput = z.infer<typeof ListStudentsInputSchema>;

/**
 * URL searchParams → ListStudentsInput 파싱 헬퍼
 */
export function parseStudentsSearchParams(
  raw: Record<string, string | string[] | undefined>,
): ListStudentsInput {
  const toArray = (v: string | string[] | undefined): string[] =>
    v === undefined ? [] : Array.isArray(v) ? v : [v];

  return ListStudentsInputSchema.parse({
    search: typeof raw.q === "string" ? raw.q : "",
    branch: typeof raw.branch === "string" ? raw.branch : undefined,
    grades: toArray(raw.grade).map((g) => Number(g)).filter((g) => [1, 2, 3].includes(g)),
    tracks: toArray(raw.track).filter((t) => t === "문과" || t === "이과"),
    statuses: toArray(raw.status).filter((s) =>
      ["재원생", "수강이력자", "신규리드", "탈퇴"].includes(s),
    ),
    page: raw.page ?? 1,
    pageSize: raw.size ?? 50,
  });
}

/**
 * 학생 생성/수정 스키마 (F1 CRUD 확장용 · 현재는 미사용, 준비만)
 */
export const StudentUpsertSchema = z.object({
  aca2000_id: z.string().min(1),
  name: z.string().min(1).max(50),
  phone: PhoneSchema.optional().or(z.literal("")),
  parent_phone: PhoneSchema.optional().or(z.literal("")),
  school: z.string().max(50).optional().or(z.literal("")),
  grade: GradeSchema.optional(),
  track: TrackSchema.optional(),
  status: StudentStatusSchema.default("재원생"),
  branch: BranchSchema,
  registered_at: z.string().optional().or(z.literal("")),
});

export type StudentUpsert = z.infer<typeof StudentUpsertSchema>;

// GroupFiltersSchema/GroupFilters 는 @/lib/schemas/group 로 이전되었습니다.
// 그룹 관련 스키마는 group.ts 를 사용하세요.
