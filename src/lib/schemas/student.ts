import { z } from "zod";
import {
  BranchSchema,
  GRADE_VALUES,
  GradeSchema,
  PhoneSchema,
  SCHOOL_LEVEL_VALUES,
  SchoolLevelSchema,
  StudentStatusSchema,
  TrackSchema,
} from "./common";

/**
 * 학생 검색·필터·페이지네이션 입력 스키마.
 * 학생 목록 Server Action 의 입력 검증용.
 *
 * 0012 마이그레이션 이후 grade 는 정규화 9종 enum (중1~졸업/미정).
 * school_level (중/고/기타) 는 1차 필터로 분리.
 * includeHidden=false 일 때 기본 숨김(졸업·미정) 적용.
 */
export const ListStudentsInputSchema = z.object({
  search: z.string().trim().max(100).optional().default(""),
  branch: z.string().optional(), // 비어있으면 "전체 분원"
  grades: z.array(GradeSchema).optional().default([]),
  schoolLevels: z.array(SchoolLevelSchema).optional().default([]),
  tracks: z.array(TrackSchema).optional().default([]),
  statuses: z.array(StudentStatusSchema).optional().default([]),
  /** 졸업·미정 같은 기본 숨김 학년을 포함할지 여부. URL ?include_hidden=1 */
  includeHidden: z.coerce.boolean().optional().default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  // 정렬은 MVP에서 기본 최신 등록 순만 지원
});

export type ListStudentsInput = z.infer<typeof ListStudentsInputSchema>;

/**
 * URL searchParams → ListStudentsInput 파싱 헬퍼
 *
 * URL 매핑:
 *   ?q=...                  → search
 *   ?branch=대치             → branch
 *   ?grade=중1&grade=고2     → grades
 *   ?level=중&level=고       → schoolLevels
 *   ?track=문과              → tracks
 *   ?status=재원생           → statuses
 *   ?include_hidden=1       → includeHidden
 *   ?page=1&size=50         → page / pageSize
 */
export function parseStudentsSearchParams(
  raw: Record<string, string | string[] | undefined>,
): ListStudentsInput {
  const toArray = (v: string | string[] | undefined): string[] =>
    v === undefined ? [] : Array.isArray(v) ? v : [v];

  const gradeWhitelist: ReadonlySet<string> = new Set(GRADE_VALUES);
  const levelWhitelist: ReadonlySet<string> = new Set(SCHOOL_LEVEL_VALUES);

  return ListStudentsInputSchema.parse({
    search: typeof raw.q === "string" ? raw.q : "",
    branch: typeof raw.branch === "string" ? raw.branch : undefined,
    grades: toArray(raw.grade).filter((g) => gradeWhitelist.has(g)),
    schoolLevels: toArray(raw.level).filter((l) => levelWhitelist.has(l)),
    tracks: toArray(raw.track).filter((t) => t === "문과" || t === "이과"),
    statuses: toArray(raw.status).filter((s) =>
      ["재원생", "수강이력자", "신규리드", "탈퇴"].includes(s),
    ),
    includeHidden: raw.include_hidden ?? false,
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
