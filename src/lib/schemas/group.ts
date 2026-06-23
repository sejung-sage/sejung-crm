import { z } from "zod";
import { GradeSchema, StudentStatusSchema, SubjectSchema } from "./common";

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
 * 발송 그룹 종류 (사용자 확정 2026-05-27 · 원장/부원장 결정).
 *
 * 한 그룹이 "필터 조건"과 "직접 추가한 학생(includeStudentIds)"을 섞어 가질 수 있어
 * 모호하던 것을 두 종류로 명확히 분리한다.
 *
 *  - 'filter' (필터 그룹): 조건(학년/학교/과목/지역/상태 + 학교·강좌 제외)만으로 정의.
 *      **항상 동기화** — 발송 시점에 조건을 재평가하므로 신규 학생이 자동 포함된다.
 *      includeStudentIds 는 해석에서 **완전히 무시**한다(동기화 보장). dynamic.
 *  - 'custom' (커스텀 그룹): includeStudentIds 로 직접 담은 **고정 명단**.
 *      필터 조건·excludeSchools·excludeClassIds 는 **무시**. 만든 시점 스냅샷. static.
 *
 * 저장 위치: 새 컬럼 마이그레이션을 피하기 위해 crm_groups.filters(JSONB) 안에 둔다
 * (0078/0079 미해결로 db push 가 막혀 있어 컬럼 추가 불가 — 추후 컬럼 승격 여지 남김).
 *
 * 백워드 호환: 키가 없으면 'filter'. 즉 기존에 저장된 모든 그룹은 자동으로 'filter'
 * 로 분류된다. 기존 그룹이 보유한 includeStudentIds 값은 JSONB 에 그대로 보존되지만
 * filter 해석에서는 무시된다(아래 "기존 그룹 함의" 참조 — 사용자 인지·결정함, 가역적).
 */
export const GroupKindSchema = z.enum(["filter", "custom"]);
export type GroupKind = z.infer<typeof GroupKindSchema>;

/** kind 미지정(옛 그룹 JSONB) 의 기본 종류. 단일 소스. */
export const DEFAULT_GROUP_KIND: GroupKind = "filter";

/**
 * filters.kind 를 안전하게 해석하는 단일 술어.
 * 키가 없거나(undefined) 옛 그룹이면 'filter' 로 폴백한다 — 수신자 해석 경로
 * (count-recipients / load-all-group-recipients / preview-recipients / apply-filters)
 * 는 직접 `filters.kind === 'custom'` 비교 대신 이 함수를 거쳐 일관성을 보장한다.
 */
export function resolveGroupKind(filters: { kind?: GroupKind }): GroupKind {
  return filters.kind ?? DEFAULT_GROUP_KIND;
}

/** 커스텀(고정 명단) 그룹 여부. resolveGroupKind 기반 단일 술어. */
export function isCustomGroup(filters: { kind?: GroupKind }): boolean {
  return resolveGroupKind(filters) === "custom";
}

/**
 * "조건이 하나도 없는" filter 코호트 여부 — 즉 분원 전원이 대상.
 *
 * 용도: 작성 화면에서 무조건 전원(분원 최대 ~6.4만)을 매칭 명단으로 불러오면 느려서
 * (전원 직렬화 ~1.3초), 조건이 없을 땐 명단 자동 로드를 건너뛴다. custom(고정 명단)은
 * includeStudentIds 가 모집단이므로 "빈 필터"가 아니다(false).
 */
export function isEmptyFilterCohort(filters: GroupFilters): boolean {
  if (isCustomGroup(filters)) return false;
  return (
    filters.grades.length === 0 &&
    filters.schools.length === 0 &&
    filters.subjects.length === 0 &&
    filters.regions.length === 0 &&
    filters.statuses.length === 0 &&
    (filters.excludeSchools?.length ?? 0) === 0 &&
    (filters.excludeClassIds?.length ?? 0) === 0 &&
    !filters.unmappedSchool &&
    !filters.mappedSchool
  );
}

/**
 * groups.filters (JSONB) 의 정규 구조.
 * 모든 필드는 선택이며, 빈 배열은 "조건 없음(전체 허용)" 의미.
 */
export const GroupFiltersSchema = z.object({
  /**
   * 그룹 종류. 'filter'(조건 동기화) | 'custom'(고정 명단).
   *
   * 출력 타입은 **선택(optional)** 이다 — 옛 그룹 JSONB·dev-seed·기존 in-memory
   * 리터럴이 kind 키 없이도 GroupFilters 로 유효하도록(백워드 호환). 키가 없으면
   * 'filter' 로 해석하되, 그 폴백은 스키마 default 가 아니라 `resolveGroupKind` /
   * `isCustomGroup` 술어로 일관 처리한다(수신자 해석 경로 단일 소스).
   *
   * 수신자 해석의 **진실(source of truth)**: filter/custom 모순 데이터
   * (예: kind 미지정인데 includeStudentIds 만 채워진 옛 그룹) 가 들어와도
   * resolveGroupKind 결과(='filter')를 기준으로 해석한다. 즉 옛 그룹의
   * includeStudentIds 는 보존되지만 filter 해석에서 무시된다.
   */
  kind: GroupKindSchema.optional(),
  /**
   * 학년: 정규화된 9종 enum (중1~고3/재수/졸업/미정). 빈 배열이면 전 학년.
   * 0012 마이그레이션 이후 students.grade 와 동일한 enum 사용.
   */
  grades: z.array(GradeSchema).default([]),
  /** 학교명: 자유 입력 문자열 배열. 빈 배열이면 전 학교 */
  schools: z.array(z.string().trim().min(1).max(40)).default([]),
  /** 과목: 공통 SubjectSchema 재사용. 빈 배열이면 전 과목 */
  subjects: z.array(SubjectSchema).default([]),
  /**
   * 지역 (다중 선택). student_profiles.region (school_regions 매핑) 정확 일치.
   *
   * 학생 명단 필터와 동일한 5종 칩(강남구/서초구/송파구/인천 송도/기타)을 그룹 빌더에
   * 노출하지만 스키마 자체는 자유 입력 문자열로 둔다 — /regions admin 에서 신규 지역이
   * 추가될 수 있고, 학생 필터에서 사용자가 다른 지역을 선택했던 그룹이 미래에 들어올
   * 가능성을 열어둠.
   *
   * 빈 배열이면 전 지역 (필터 미적용). 0026 마이그 이후 region 은 NOT NULL/COALESCE 라
   * 매칭은 항상 안전.
   *
   * 백워드 호환: `.default([])` 라 0026 이전에 저장된 옛 그룹 JSONB 에 regions 키가
   * 없어도 getGroup 에서 parse 시점에 빈 배열로 채워진다.
   */
  regions: z.array(z.string().trim().min(1).max(30)).default([]),
  /**
   * 재원 상태 (다중 선택). 빈 배열이면 default = ['재원생'] 매칭 (안전한 기본).
   * 학생 명단 필터의 "전체" 와 동일한 효과를 내려면 ['재원생','수강이력자','수강 x'] 셋
   * 모두 명시. 탈퇴 학생은 어떤 경우에도 자동 제외 (수신자 안전 정책).
   *
   * 백워드 호환: 옛 그룹 JSONB 에 statuses 키가 없으면 빈 배열로 채워지고,
   * 수신자 산정 단에서 default '재원생' 으로 처리 — 즉 기존 그룹의 의미가
   * 그대로 유지된다.
   */
  statuses: z.array(StudentStatusSchema).default([]),
  /**
   * 명시적으로 추가한 학생 ID 목록. 조건(grades/schools/subjects) 결과와
   * union 되어 최종 수신자에 포함된다. 본인 폰 테스트 또는 특정 학생 1~몇명
   * 콕 찍어 보낼 때 사용. 자동 제외(탈퇴·수신거부)는 동일하게 적용.
   */
  includeStudentIds: z.array(z.string().uuid()).default([]),
  /**
   * 그룹 단건 삭제(2026-05-19): 그룹 상세에서 특정 학생을 빼고 싶을 때 사용.
   * - includeStudentIds 에 직접 박힌 학생이면 그 배열에서 제거.
   * - 조건 매칭으로 들어온 학생이면 이 배열에 그 id 를 적재 →
   *   수신자 산정 시 강제 제외.
   * 빈 배열이면 조건 매칭 결과를 그대로 사용.
   *
   * 백워드 호환: `.default([])` 이라 옛 그룹 JSONB 에 없어도 안전.
   */
  excludeStudentIds: z.array(z.string().uuid()).default([]),
  /**
   * 학교별 제외 (박은주 부원장 요청 2026-05-27). schools(포함) 의 대칭 필드.
   * student.school IN (excludeSchools) 면 최종 수신자에서 제외한다.
   *
   * 용도: 학교별 진도 차이로 "이번 안내는 A·B 고만 빼고 보냄" 같은 케이스.
   * 자유 입력 문자열(schools 와 동일 규칙) — students.school 원값과 정확 일치 매칭.
   *
   * 적용 순서: include(조건 + includeStudentIds) 산정 → exclude 차감 단계에서
   *   excludeStudentIds / excludeSchools / excludeClassIds 와 함께 제거.
   *   include 와 exclude 가 겹치면 exclude 가 승리(차감 우선).
   *
   * 백워드 호환: `.default([])` 라 옛 그룹 JSONB 에 키가 없어도 빈 배열 = "제외 없음".
   */
  excludeSchools: z.array(z.string().trim().min(1).max(40)).default([]),
  /**
   * 강좌별 제외 (박은주 부원장 요청 2026-05-27). crm_classes.id (UUID) 목록.
   * 해당 강좌(들)에 현재 수강(enrollment)이 있는 학생을 최종 수신자에서 제외한다.
   *
   * 용도: "교재 이미 받은 강좌 수강생 제외", "다른 강좌 듣는 학생 혼란 방지".
   *
   * ── 동적(dynamic) 결정 근거 ──────────────────────────────
   * include 의 강좌 prefill 은 학생을 includeStudentIds 로 펼치는 정적 방식이지만,
   * 제외는 강좌 id 자체를 저장해 **발송 시점에 그 강좌 현재 수강생을 동적으로 차감**한다.
   *   - 그룹은 filters 만 저장하고 발송 시점 재조회한다는 그룹 철학과 일치.
   *   - 강좌에 새로 들어온 학생(교재 새로 받은 학생)도 자동 제외되어, 빌드 시점
   *     정적 펼침이 놓치는 "신규 수강생 누락" 혼란을 방지.
   * 정적으로 펼치면 그룹을 다시 편집하지 않는 한 새 수강생이 발송 대상에 남는다.
   *
   * ── 매핑 경로 (수신자 해석 시) ──────────────────────────
   * crm_classes.id IN (excludeClassIds) → crm_classes.aca_class_id 페치 →
   * crm_enrollments.aca_class_id IN (그 aca_class_id) → student_id 차집합.
   * (crm_enrollments 는 class.id 가 아닌 aca_class_id 로 연결됨. aca_class_id 가
   *  NULL 인 자체 등록 강좌는 enrollment 매칭이 불가하므로 제외 대상 0명.)
   *
   * 백워드 호환: `.default([])` 라 옛 그룹 JSONB 에 키가 없어도 빈 배열 = "제외 없음".
   */
  excludeClassIds: z.array(z.string().uuid()).default([]),
  /**
   * 학교 미등록 학생만. 학생 명단의 unmappedSchool 와 정확히 동일 의미.
   * school IS NULL OR school IN (UNMAPPED_SCHOOL_PATTERNS).
   * 백워드 호환: `.default(false)`.
   */
  unmappedSchool: z.boolean().default(false),
  /**
   * 학교 등록만. unmappedSchool 의 반대. 둘 다 true 면 unmapped 우선.
   */
  mappedSchool: z.boolean().default(false),
});
export type GroupFilters = z.infer<typeof GroupFiltersSchema>;

/**
 * custom 그룹 검증 술어 — "고정 명단인데 명단이 비어 있으면 무효".
 * 단일 소스로 export 하여 Server Action·폼 검증이 같은 규칙을 공유.
 *
 * 규칙(사용자 확정):
 *  - kind='custom' → includeStudentIds 는 최소 1명. (빈 커스텀 그룹 금지 —
 *    아무에게도 안 가는 그룹은 오발송·혼란의 소지라 생성 단계에서 차단.)
 *  - kind='filter' → 별도 제약 없음. 조건이 전부 비어 있으면 현행대로
 *    "분원 전체(탈퇴/수신거부 제외)" 로 해석된다. includeStudentIds 유무 무관.
 */
export function isValidCustomGroupFilters(filters: GroupFilters): boolean {
  if (!isCustomGroup(filters)) return true;
  return filters.includeStudentIds.length >= 1;
}

/**
 * 그룹 생성 입력.
 * - name/branch 는 필수
 * - filters 는 비어 있어도 유효(=전체) — 단 custom 종류는 명단 1명 이상 필수.
 */
export const CreateGroupInputSchema = z
  .object({
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
  })
  .refine((v) => isValidCustomGroupFilters(v.filters), {
    message: "커스텀 그룹은 학생을 1명 이상 직접 추가해야 합니다",
    path: ["filters", "includeStudentIds"],
  });
export type CreateGroupInput = z.infer<typeof CreateGroupInputSchema>;

/**
 * 그룹 수정 입력. 부분 변경 허용.
 * id 는 UUID 문자열.
 *
 * 주의: `.refine` 가 걸린 스키마는 `.partial()`/`.extend()` 를 못 쓰므로 base
 * object 를 따로 두고 거기서 파생한다. custom 검증은 filters 가 함께 들어올 때만
 * 수행(부분 수정에서 filters 미제출이면 스킵 — Server Action 이 머지 후 재검증).
 */
const UpdateGroupBaseSchema = z.object({
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
export const UpdateGroupInputSchema = UpdateGroupBaseSchema.partial()
  .extend({
    id: z.string().uuid("그룹 ID 가 유효하지 않습니다"),
  })
  .refine((v) => v.filters === undefined || isValidCustomGroupFilters(v.filters), {
    message: "커스텀 그룹은 학생을 1명 이상 직접 추가해야 합니다",
    path: ["filters", "includeStudentIds"],
  });
export type UpdateGroupInput = z.infer<typeof UpdateGroupInputSchema>;

/**
 * /groups/new?class=<id>&filter=... 강좌 prefill 의 filter 파라미터.
 *
 * "종강 강좌 → 다음 시즌 미등록(이탈) 추적" 기능(박은주 부원장 2026-05-27)용.
 *  - 'all'    : 강좌 수강생 전체를 includeStudentIds 로 prefill (기존 동작, 기본값).
 *  - 'lapsed' : 강좌 수강생 중 **이탈 학생만** prefill.
 *               이탈 정의 = crm_students.status !== '재원생'
 *               (재원생 = 어딘가 진행 중 수강 보유 → 다음 시즌도 다니는 중이라 제외).
 *               status ∈ {수강이력자, 수강 x, 탈퇴} 가 이탈 후보.
 *
 * 미지정/오타/빈 값은 모두 'all' 로 폴백 (catch). 강좌 prefill 이 없는
 * (student prefill 또는 prefill 없음) 진입에서는 이 값을 무시한다.
 *
 * 해석 위치: groups/new page 의 강좌 prefill 로직(서버). getClassDetail 이
 * 이제 ClassStudentRow.status 를 들고 오므로 별도 추가 쿼리 없이 students 를
 * status !== '재원생' 으로 거른 뒤 그 id 만 recipients/includeStudentIds 로 채운다.
 *
 * 탈퇴 학생: 이탈 명단(prefill)에는 포함되지만, 발송 시점에 기존 안전 가드가
 * 탈퇴/수신거부를 자동 제외하므로 실제 수신자에서는 빠진다. (이중 정책 의도적)
 */
export const ClassPrefillFilterSchema = z
  .enum(["all", "lapsed"])
  .catch("all");
export type ClassPrefillFilter = z.infer<typeof ClassPrefillFilterSchema>;

/**
 * 학생이 "이탈(lapsed)" 후보인지 판정.
 * 단일 소스 — page prefill, UI 섹션 카운트가 같은 술어를 공유하도록 export.
 * 이탈 = 재원생이 아님 (어디에도 진행 중 수강이 없음).
 */
export function isLapsedStudent(status: string): boolean {
  return status !== "재원생";
}

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
