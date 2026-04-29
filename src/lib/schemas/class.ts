import { z } from "zod";
import { SubjectSchema } from "./common";

/**
 * 강좌 리스트(F0 · /classes) Zod 스키마
 *
 * 학생 리스트(`student.ts`)의 `ListStudentsInputSchema` /
 * `parseStudentsSearchParams` 패턴을 그대로 미러링.
 *
 * 사용자 확정 정책 (MVP · Phase 0):
 *  - 필터는 분원 · 과목 · 자유 검색(반명+강사명) 3개만.
 *  - 기본은 `active=true` (미사용 강좌 숨김). `?active=0` 으로만 false 토글.
 *  - 정렬은 MVP 에서 기본 등록 최신 순만 지원 (정렬 입력 없음).
 *
 * DB 컬럼은 영어 snake_case, UI 라벨은 한글. 에러 메시지는 전부 한글.
 */

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
  /**
   * 미사용 강좌 숨김 여부. 기본 true.
   * URL `?active=0` 일 때만 false (검색 옵션).
   */
  active: z.coerce.boolean().optional().default(true),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

export type ClassFilters = z.infer<typeof ClassFiltersSchema>;

/**
 * URL searchParams → ClassFilters 파싱 헬퍼
 *
 * URL 매핑 (학생 리스트와 동일 컨벤션):
 *   ?q=...              → search
 *   ?branch=대치        → branch
 *   ?subject=수학       → subject
 *   ?active=0           → active=false (그 외에는 항상 true)
 *   ?page=1             → page
 *   ?size=20            → pageSize
 */
export function parseClassSearchParams(
  raw: Record<string, string | string[] | undefined>,
): ClassFilters {
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

  return ClassFiltersSchema.parse({
    search: typeof raw.q === "string" ? raw.q : "",
    branch: branchRaw === "" ? undefined : branchRaw,
    subject,
    active,
    page: raw.page ?? 1,
    pageSize: raw.size ?? 20,
  });
}
