import { z } from "zod";
import { SubjectSchema } from "./common";

/**
 * 강좌 리스트(F0 · /classes) Zod 스키마
 *
 * 학생 리스트(`student.ts`)의 `ListStudentsInputSchema` /
 * `parseStudentsSearchParams` 패턴을 그대로 1:1 미러링.
 *
 * 사용자 확정 정책 (MVP · Phase 0):
 *  - 필터: 분원 · 과목 · 강사(다중) · 요일(다중) · 자유 검색(반명+강사명).
 *  - 기본은 `active=true` (미사용 강좌 숨김). `?active=0` 으로만 false 토글.
 *  - 정렬은 6+종 토글 — 사용자 확정 (`CLASS_SORT_VALUES`).
 *
 * DB 컬럼은 영어 snake_case, UI 라벨은 한글. 에러 메시지는 전부 한글.
 */

/**
 * 강좌 리스트 정렬 옵션.
 * 학생 리스트의 `STUDENT_SORT_VALUES` 패턴을 그대로 미러.
 *
 * - default               : 기본 — branch ASC > subject ASC NULLS LAST > name ASC (현행 동작)
 * - registered_desc/asc   : 강좌 등록일(registered_at)
 * - start_date_desc/asc   : 개강일(start_date) — 0019 마이그레이션으로 추가된 컬럼.
 *                            NULLS LAST 일관 (백필 미적용 행은 항상 뒤로).
 * - name_asc/desc         : 반명(name)
 * - enrolled_count_*      : 수강생 수 (ClassListItem 집계 필드 · 정원 미달 케어용 asc 포함)
 * - capacity_desc         : 정원(capacity) 많은 순
 * - amount_per_session_*  : 회당단가
 * - total_sessions_desc   : 총회차
 */
export const CLASS_SORT_VALUES = [
  "default",
  "registered_desc",
  "registered_asc",
  "start_date_desc",
  "start_date_asc",
  "name_asc",
  "name_desc",
  "enrolled_count_desc",
  "enrolled_count_asc",
  "capacity_desc",
  "amount_per_session_desc",
  "amount_per_session_asc",
  "total_sessions_desc",
] as const;
export const ClassSortSchema = z.enum(CLASS_SORT_VALUES);
export type ClassSort = z.infer<typeof ClassSortSchema>;

/**
 * 요일 필터 화이트리스트.
 * `classes.schedule_days` 는 자유 입력 문자열 ("화목", "월수금" 등) 이라
 * 단일 요일을 substring 매칭하는 책임은 backend-dev 에 위임.
 * 이 스키마는 입력값이 안전한 한 글자 요일임만 보장한다.
 */
export const CLASS_DAY_VALUES = [
  "월",
  "화",
  "수",
  "목",
  "금",
  "토",
  "일",
] as const;
export const ClassDaySchema = z.enum(CLASS_DAY_VALUES);
export type ClassDay = z.infer<typeof ClassDaySchema>;

/**
 * 강좌 검색·필터·페이지네이션 입력 스키마.
 * 강좌 목록 Server Action 의 입력 검증용.
 */
export const ClassFiltersSchema = z.object({
  /** 반명 + 강사명 LIKE 검색용 단일 입력. 빈 문자열이면 검색 미적용. */
  search: z.string().trim().max(100).optional().default(""),
  /** 분원: 빈 문자열이면 "전체 분원". */
  branch: z.string().optional(),
  /** 과목: 빈 문자열/미지정이면 전체 과목. */
  subject: SubjectSchema.optional(),
  /** 강사명 필터 (다중 선택). classes.teacher_name 정확 일치 (backend-dev 처리). */
  teachers: z.array(z.string().trim().max(50)).optional().default([]),
  /**
   * 요일 필터 (다중 선택).
   * schedule_days 가 자유형 ("화목", "월수금") 이라 단일 요일 substring 매칭.
   * 다중 선택 시 OR 매칭 (backend-dev 처리).
   */
  days: z.array(ClassDaySchema).optional().default([]),
  /**
   * 미사용 강좌 숨김 여부. 기본 true.
   * URL `?active=0` 일 때만 false (검색 옵션).
   */
  active: z.coerce.boolean().optional().default(true),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  /** 정렬 옵션. 기본은 현행 동작(default · branch>subject>name). */
  sort: ClassSortSchema.optional().default("default"),
});

export type ClassFilters = z.infer<typeof ClassFiltersSchema>;

/**
 * URL searchParams → ClassFilters 파싱 헬퍼
 *
 * URL 매핑 (학생 리스트와 동일 컨벤션 — 반복 파라미터):
 *   ?q=...                          → search
 *   ?branch=대치                     → branch
 *   ?subject=수학                    → subject
 *   ?teacher=김선생&teacher=박선생   → teachers (다중)
 *   ?day=화&day=목                   → days (다중)
 *   ?active=0                        → active=false (그 외에는 항상 true)
 *   ?sort=enrolled_count_desc        → sort (화이트리스트 외엔 default)
 *   ?page=1                          → page
 *   ?size=20                         → pageSize
 *
 * array 필드는 모두 동일 패턴 — 반복 파라미터 (`?key=a&key=b`).
 * Next.js App Router 는 반복 키를 string[] 로 자동 묶어줌.
 */
export function parseClassSearchParams(
  raw: Record<string, string | string[] | undefined>,
): ClassFilters {
  const toArray = (v: string | string[] | undefined): string[] =>
    v === undefined ? [] : Array.isArray(v) ? v : [v];

  // 강사는 자유 입력값 — 빈 문자열만 걸러내고 길이 컷오프(50자)는 Zod 가 처리.
  const cleanFreeText = (arr: string[]): string[] =>
    arr.map((s) => s.trim()).filter((s) => s.length > 0);

  const subjectRaw = typeof raw.subject === "string" ? raw.subject : "";
  const subject =
    subjectRaw === "수학" ||
    subjectRaw === "국어" ||
    subjectRaw === "영어" ||
    subjectRaw === "탐구"
      ? subjectRaw
      : undefined;

  const branchRaw = typeof raw.branch === "string" ? raw.branch : "";

  // active 는 명시적으로 "0" 일 때만 false. 그 외(미지정 포함)는 true.
  const activeRaw = typeof raw.active === "string" ? raw.active : undefined;
  const active = activeRaw === "0" ? false : true;

  // sort 는 화이트리스트 검사 후 통과. 그 외는 undefined → 스키마 default("default").
  const sortWhitelist: ReadonlySet<string> = new Set(CLASS_SORT_VALUES);
  const sortRaw = typeof raw.sort === "string" ? raw.sort : undefined;
  const sort = sortRaw && sortWhitelist.has(sortRaw) ? sortRaw : undefined;

  // days 는 z.enum 화이트리스트로 안전. 미리 한 번 거르고 Zod 에 위임.
  const dayWhitelist: ReadonlySet<string> = new Set(CLASS_DAY_VALUES);

  return ClassFiltersSchema.parse({
    search: typeof raw.q === "string" ? raw.q : "",
    branch: branchRaw === "" ? undefined : branchRaw,
    subject,
    teachers: cleanFreeText(toArray(raw.teacher)),
    days: toArray(raw.day).filter((d) => dayWhitelist.has(d)),
    active,
    page: raw.page ?? 1,
    pageSize: raw.size ?? 20,
    sort,
  });
}
