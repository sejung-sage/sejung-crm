import { z } from "zod";
import {
  BranchSchema,
  GRADE_VALUES,
  GradeSchema,
  PhoneSchema,
  SCHOOL_LEVEL_VALUES,
  SchoolLevelSchema,
  StudentStatusSchema,
  SubjectSchema,
  TrackSchema,
} from "./common";

/**
 * 학생 리스트 정렬 옵션.
 * student_profiles 뷰의 컬럼을 그대로 활용:
 *  - registered_at         (등록일)
 *  - name                  (이름)
 *  - attendance_rate       (출석률 %)
 *  - enrollment_count      (수강 강좌 수)
 *  - total_paid            (누적 결제 금액)
 */
export const STUDENT_SORT_VALUES = [
  "registered_desc",
  "registered_asc",
  "name_asc",
  "name_desc",
  "attendance_desc",
  "attendance_asc",
  "enrollment_count_desc",
  "total_paid_desc",
] as const;
export const StudentSortSchema = z.enum(STUDENT_SORT_VALUES);
export type StudentSort = z.infer<typeof StudentSortSchema>;

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
  /** 수강 과목 필터 (다중 선택). student_profiles.subjects (text[]) 와 교집합. */
  subjects: z.array(SubjectSchema).optional().default([]),
  /** 강사명 필터 (다중 선택). student_profiles.teachers (text[]) 와 교집합. */
  teachers: z.array(z.string().trim().max(50)).optional().default([]),
  /** 학교 필터 (다중 선택). students.school 정확 일치. */
  schools: z.array(z.string().trim().max(50)).optional().default([]),
  /** 졸업·미정 같은 기본 숨김 학년을 포함할지 여부. URL ?include_hidden=1 */
  includeHidden: z.coerce.boolean().optional().default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  /** 정렬 옵션. 기본은 최근 등록순. */
  sort: StudentSortSchema.optional().default("registered_desc"),
});

export type ListStudentsInput = z.infer<typeof ListStudentsInputSchema>;

/**
 * URL searchParams → ListStudentsInput 파싱 헬퍼
 *
 * URL 매핑:
 *   ?q=...                          → search
 *   ?branch=대치                     → branch
 *   ?grade=중1&grade=고2             → grades
 *   ?level=중&level=고               → schoolLevels
 *   ?track=문과                      → tracks
 *   ?status=재원생                   → statuses
 *   ?subject=수학&subject=국어       → subjects (다중 선택)
 *   ?teacher=김선생&teacher=박선생   → teachers (다중 선택)
 *   ?school=대치고&school=휘문고     → schools (다중 선택)
 *   ?sort=attendance_asc            → sort
 *   ?include_hidden=1               → includeHidden
 *   ?page=1&size=50                 → page / pageSize
 *
 * array 필드는 모두 동일 패턴 — 반복 파라미터 (`?key=a&key=b`).
 * Next.js App Router 는 반복 키를 string[] 로 자동 묶어줌.
 */
export function parseStudentsSearchParams(
  raw: Record<string, string | string[] | undefined>,
): ListStudentsInput {
  const toArray = (v: string | string[] | undefined): string[] =>
    v === undefined ? [] : Array.isArray(v) ? v : [v];

  const gradeWhitelist: ReadonlySet<string> = new Set(GRADE_VALUES);
  const levelWhitelist: ReadonlySet<string> = new Set(SCHOOL_LEVEL_VALUES);
  const subjectWhitelist: ReadonlySet<string> = new Set([
    "수학",
    "국어",
    "영어",
    "탐구",
  ]);
  const sortWhitelist: ReadonlySet<string> = new Set(STUDENT_SORT_VALUES);

  // 강사·학교는 자유 입력값 — 빈 문자열만 걸러내고 길이 컷오프(50자)는 Zod 가 처리.
  const cleanFreeText = (arr: string[]): string[] =>
    arr.map((s) => s.trim()).filter((s) => s.length > 0);

  const sortRaw = typeof raw.sort === "string" ? raw.sort : undefined;
  const sort = sortRaw && sortWhitelist.has(sortRaw) ? sortRaw : undefined;

  return ListStudentsInputSchema.parse({
    search: typeof raw.q === "string" ? raw.q : "",
    branch: typeof raw.branch === "string" ? raw.branch : undefined,
    grades: toArray(raw.grade).filter((g) => gradeWhitelist.has(g)),
    schoolLevels: toArray(raw.level).filter((l) => levelWhitelist.has(l)),
    tracks: toArray(raw.track).filter((t) => t === "문과" || t === "이과"),
    statuses: toArray(raw.status).filter((s) =>
      ["재원생", "수강이력자", "신규리드", "탈퇴"].includes(s),
    ),
    subjects: toArray(raw.subject).filter((s) => subjectWhitelist.has(s)),
    teachers: cleanFreeText(toArray(raw.teacher)),
    schools: cleanFreeText(toArray(raw.school)),
    sort,
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
