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
 * groups.filters (JSONB) 의 정규 구조.
 * 모든 필드는 선택이며, 빈 배열은 "조건 없음(전체 허용)" 의미.
 */
export const GroupFiltersSchema = z.object({
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
