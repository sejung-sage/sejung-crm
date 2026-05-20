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
 * - end_date_desc/asc     : 종강일(end_date) — 0020 마이그레이션으로 추가된 컬럼.
 *                            NULLS LAST 일관 (진행 중 표기인 NULL/미정행은 뒤로).
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
  "end_date_desc",
  "end_date_asc",
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
  /**
   * 진행/설명회 상태 필터. 기본 "all" (필터 미적용).
   *
   * 토글 3종 (UI 노출):
   *  - "all"         : 필터 미적용 (전체)
   *  - "progressing" : 진행 중 — end_date IS NULL OR end_date >= 오늘
   *                    AND 종강/폐강 prefix(4종) 미시작
   *                    AND subject <> '설명회'
   *  - "seminar"     : 설명회 — subject = '설명회' 만
   *
   * 호환 유지:
   *  - "graduated"   : 종강 강좌 — 외부 직딥 링크/북마크 호환을 위해 enum 에 남김.
   *                    end_date < 오늘 OR 이름 prefix(4종) 매칭. 토글 UI 에는 미노출.
   *
   * (0020 마이그레이션 후 백필 분포: NULL 440 / 미정(>=2050) 695 /
   *  종강(<오늘) 1,782 / 진행 중(명시) 2 — "미정" 행도 진행 중으로 분류됨.)
   */
  status: z
    .enum(["all", "progressing", "graduated", "seminar"])
    .optional()
    .default("all"),
  /**
   * 기간 필터 시작일 — "이 날짜 이상에 ticket(=수업 회차 예정일) 이 잡힌 강좌".
   *
   * 형식: 'YYYY-MM-DD'. schema 단계에서 정규식 검증.
   * 매칭 룰 (앱 레이어):
   *  - aca_tickets.class_date >= startDate 를 만족하는 distinct aca_class_id 셋
   *  - 그 셋을 classes 의 aca_class_id 에 IN 매칭
   *
   * `endDate` 와 함께 또는 단독 사용 가능 (한쪽만 들어와도 무한 끝까지).
   * classes.start_date/end_date 운영기간 백필과 무관 — ticket 실존 기준 매칭.
   */
  startDate: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}$/u,
      "시작일 형식이 올바르지 않습니다 (YYYY-MM-DD).",
    )
    .optional(),
  /**
   * 기간 필터 종료일 — "이 날짜 이하에 ticket(=수업 회차 예정일) 이 잡힌 강좌".
   *
   * 형식: 'YYYY-MM-DD'. schema 단계에서 정규식 검증.
   * 매칭 룰 (앱 레이어):
   *  - aca_tickets.class_date <= endDate 를 만족하는 distinct aca_class_id 셋
   *
   * `startDate` 와 함께 또는 단독 사용 가능 (한쪽만 들어와도 무한 처음부터).
   */
  endDate: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}$/u,
      "종료일 형식이 올바르지 않습니다 (YYYY-MM-DD).",
    )
    .optional(),
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
 *   ?status=progressing              → status=progressing (화이트리스트 외엔 all)
 *   ?status=seminar                  → status=seminar
 *   ?status=graduated                → status=graduated (호환용 · UI 노출 X)
 *   ?start=2026-05-01                → startDate (기간 필터 시작일)
 *   ?end=2026-05-31                  → endDate   (기간 필터 종료일)
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
  const SUBJECT_WHITELIST: ReadonlySet<string> = new Set([
    "국어",
    "영어",
    "수학",
    "과탐",
    "사탐",
    "컨설팅",
    "기타",
  ]);
  const subject = SUBJECT_WHITELIST.has(subjectRaw) ? subjectRaw : undefined;

  const branchRaw = typeof raw.branch === "string" ? raw.branch : "";

  // active 는 명시적으로 "0" 일 때만 false. 그 외(미지정 포함)는 true.
  // 신규 alias: `?inactive=1` 도 false 와 동등 (종강·폐강 포함).
  // 학생 명단의 `?include_hidden=1` 와 톤 맞춤. 두 alias 가 동시에 들어오면
  // 어느 쪽이든 false → 미사용 강좌 노출.
  const activeRaw = typeof raw.active === "string" ? raw.active : undefined;
  const inactiveRaw = typeof raw.inactive === "string" ? raw.inactive : undefined;
  const includeInactive = activeRaw === "0" || inactiveRaw === "1";
  const active = includeInactive ? false : true;

  // status 는 화이트리스트 검사 후 통과. 그 외(미지정 포함)는 undefined → 스키마 default("all").
  // "graduated" 는 외부 링크/북마크 호환을 위해 화이트리스트에 남기되 토글 UI 에선 미노출.
  const statusWhitelist: ReadonlySet<string> = new Set([
    "all",
    "progressing",
    "graduated",
    "seminar",
  ]);
  const statusRaw = typeof raw.status === "string" ? raw.status : undefined;
  const status =
    statusRaw && statusWhitelist.has(statusRaw) ? statusRaw : undefined;

  // sort 는 화이트리스트 검사 후 통과. 그 외는 undefined → 스키마 default("default").
  const sortWhitelist: ReadonlySet<string> = new Set(CLASS_SORT_VALUES);
  const sortRaw = typeof raw.sort === "string" ? raw.sort : undefined;
  const sort = sortRaw && sortWhitelist.has(sortRaw) ? sortRaw : undefined;

  // days 는 z.enum 화이트리스트로 안전. 미리 한 번 거르고 Zod 에 위임.
  const dayWhitelist: ReadonlySet<string> = new Set(CLASS_DAY_VALUES);

  // startDate / endDate 형식 가드 — Zod 정규식이 한 번 더 검증하므로 여기서는
  // string 타입만 좁힌다. 한쪽만 들어와도 OK (반대편은 무한대 의미).
  // URL 키는 짧게 `start` / `end` 로 통일. 한 번 더 호환을 위해 `startDate` /
  // `endDate` 도 받음 (form submit 등에서 동일 키 사용 케이스 대비).
  const pickDate = (
    primary: string | string[] | undefined,
    fallback?: string | string[] | undefined,
  ): string | undefined => {
    const cand = typeof primary === "string" ? primary : undefined;
    if (cand && /^\d{4}-\d{2}-\d{2}$/u.test(cand)) return cand;
    const fb = typeof fallback === "string" ? fallback : undefined;
    if (fb && /^\d{4}-\d{2}-\d{2}$/u.test(fb)) return fb;
    return undefined;
  };
  const startDate = pickDate(raw.start, raw.startDate);
  const endDate = pickDate(raw.end, raw.endDate);

  return ClassFiltersSchema.parse({
    search: typeof raw.q === "string" ? raw.q : "",
    branch: branchRaw === "" ? undefined : branchRaw,
    subject,
    teachers: cleanFreeText(toArray(raw.teacher)),
    days: toArray(raw.day).filter((d) => dayWhitelist.has(d)),
    active,
    status,
    startDate,
    endDate,
    page: raw.page ?? 1,
    pageSize: raw.size ?? 20,
    sort,
  });
}
