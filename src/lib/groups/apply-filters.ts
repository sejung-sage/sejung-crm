/**
 * F2 발송 그룹 · 공통 필터 적용 로직 (dev-seed 용)
 *
 * `GroupFilters` + 분원 + 자동 제외 규칙(비활성 학생·수신거부)을 학생 프로필 배열에
 * 적용해 수신 대상 목록을 계산한다. Supabase 경로에서는 뷰 쿼리 + JS 필터로
 * 같은 규칙을 적용하므로, 본 모듈은 주로 개발 모드에서 재사용된다.
 *
 * 규칙 요약 (사용자 확정 · MVP):
 *   1) 분원 일치
 *   2) students.status = '탈퇴' 강제 제외
 *   3) unsubscribes 에 학부모 번호가 있으면 강제 제외
 *   4) filters.grades / schools / subjects (빈 배열은 조건 없음)
 *   5) 최근 3회 수신자 제외는 Phase 1 → 본 모듈에서 다루지 않음
 */

import type { GroupFilters } from "@/lib/schemas/group";
import { isCustomGroup } from "@/lib/schemas/group";
import type { StudentProfileRow, Subject } from "@/types/database";
import { DEV_ENROLLMENTS } from "@/lib/profile/students-dev-seed";
import { UNMAPPED_SCHOOL_PATTERNS } from "@/lib/schemas/common";

/** dev-seed 는 unsubscribes 데이터를 제공하지 않음. 일관성을 위해 옵션 인자로 받는다. */
export interface ApplyGroupFiltersOptions {
  /** 학부모 번호 기준 수신거부 셋 (없으면 빈 셋) */
  unsubscribedPhones?: Set<string>;
}

/**
 * 개발용 인메모리 학생 프로필 배열에 그룹 필터를 적용한다.
 * 수강 과목 매칭은 DEV_ENROLLMENTS 를 참조해 student_id → subjects 셋을 만들고 교집합 검사.
 */
export function applyGroupFiltersDev(
  profiles: StudentProfileRow[],
  filters: GroupFilters,
  branch: string,
  options: ApplyGroupFiltersOptions = {},
): StudentProfileRow[] {
  const unsub = options.unsubscribedPhones ?? new Set<string>();
  const subjectIndex = buildDevSubjectIndex();

  const branchTrim = branch.trim();

  // ── kind 분기 (2026-05-27) ─────────────────────────────────
  // 'custom' (고정 명단): includeStudentIds 만 모집단. excludeStudentIds 차감은
  //   유지하되 필터 조건·excludeSchools·excludeClassIds 는 모두 무시.
  // 'filter' (조건 동기화): grades/schools/subjects/regions/statuses + unmapped/mapped
  //   조건으로 모집단 산정. includeStudentIds 는 완전히 무시. excludeStudentIds +
  //   excludeSchools + excludeClassIds 차감.
  // 직접 filters.kind 비교 금지 — 단일 술어 isCustomGroup 경유.
  const custom = isCustomGroup(filters);

  // 그룹 단건 삭제(2026-05-19) — 명시 제외 set. 두 종류 공통(custom 도 개별 제거 유지).
  const excludeSet =
    filters.excludeStudentIds && filters.excludeStudentIds.length > 0
      ? new Set(filters.excludeStudentIds)
      : null;

  if (custom) {
    // 커스텀(고정 명단) 경로 — includeStudentIds 모집단 − excludeStudentIds.
    // 빈 includeStudentIds 면 모집단 0명 → 빈 결과 안전 반환.
    const includeSet = new Set(filters.includeStudentIds);
    return profiles.filter((p) => {
      // 1) 분원
      if (branchTrim && p.branch !== branchTrim) return false;
      // 2) 비활성(탈퇴) 제외 — 안전 정책상 항상 차단(가드).
      if (p.status === "탈퇴") return false;
      // 3) 수신거부 제외 (학부모 연락처 기준, 가드).
      if (p.parent_phone && unsub.has(p.parent_phone)) return false;
      // 4) 명시 제외(excludeStudentIds) — 커스텀 명단 개별 제거.
      if (excludeSet && excludeSet.has(p.id)) return false;
      // 5) 고정 명단 매칭만 — 필터 조건/excludeSchools/excludeClassIds 는 무시.
      return includeSet.has(p.id);
    });
  }

  // ── filter (조건 동기화) 경로 ───────────────────────────────
  // 학교별 제외 (2026-05-27) — student.school IN (excludeSchools) 면 차감.
  // school === null 은 차감 대상 아님 (Supabase NOT IN 과 동일 시맨틱).
  const excludeSchoolSet =
    filters.excludeSchools && filters.excludeSchools.length > 0
      ? new Set(filters.excludeSchools)
      : null;

  // 강좌별 제외 (2026-05-27) — excludeClassIds(aca_class_id) → student_id 차감.
  //   dev-seed 엔 crm_classes 시드가 없어 crm_classes.id → aca_class_id 변환 불가.
  //   DEV_ENROLLMENTS 의 aca_class_id 인덱스로 직접 매칭한다 (best-effort).
  //   시드 enrollment 의 aca_class_id 는 모두 NULL 이라 실제 매칭은 0명 —
  //   "aca_class_id NULL(자체 등록 강좌)은 매칭 0명" 계약과 일치.
  const excludeClassStudentSet =
    filters.excludeClassIds && filters.excludeClassIds.length > 0
      ? buildDevExcludeClassStudentSet(filters.excludeClassIds)
      : null;

  return profiles.filter((p) => {
    // 1) 분원
    if (branchTrim && p.branch !== branchTrim) return false;

    // 2) 비활성(탈퇴) 제외 — 안전 정책상 status 필터 값과 무관하게 항상 차단.
    if (p.status === "탈퇴") return false;

    // 3) 수신거부 제외 (학부모 연락처 기준)
    if (p.parent_phone && unsub.has(p.parent_phone)) return false;

    // 3.5) 제외 차감(exclude 승리) — 조건 매칭보다 먼저 적용.
    //   ① 명시 제외(excludeStudentIds)
    if (excludeSet && excludeSet.has(p.id)) return false;
    //   ② 학교별 제외 — school null 은 차감 안 함.
    if (excludeSchoolSet && p.school !== null && excludeSchoolSet.has(p.school)) {
      return false;
    }
    //   ③ 강좌별 제외 — 제외 강좌 수강 학생 차감.
    if (excludeClassStudentSet && excludeClassStudentSet.has(p.id)) return false;

    // 4) 재원 상태 — 빈 배열이면 default '탈퇴 빼고 전체' (재원생/수강이력자/수강 x).
    // 옛 그룹 JSONB 호환성을 위해 빈 배열의 시맨틱은 "조건 없음" = 전체로 해석.
    const wantedStatuses =
      filters.statuses.length > 0
        ? filters.statuses
        : ["재원생", "수강이력자", "수강 x"];
    if (!wantedStatuses.includes(p.status)) return false;

    // 5) 조건 절. includeStudentIds 는 filter 경로에서 완전히 무시(동기화 보장).
    if (filters.grades.length > 0) {
      if (p.grade === null) return false;
      if (!filters.grades.includes(p.grade)) return false;
    }

    if (filters.schools.length > 0) {
      if (!p.school) return false;
      if (!filters.schools.includes(p.school)) return false;
    }

    // 학교 미등록/등록 토글 — 학생 명단 dev-seed 와 동일 로직.
    if (filters.unmappedSchool) {
      const ph = new Set<string>(UNMAPPED_SCHOOL_PATTERNS);
      if (!(p.school === null || ph.has(p.school.trim()))) return false;
    } else if (filters.mappedSchool) {
      const ph = new Set<string>(UNMAPPED_SCHOOL_PATTERNS);
      if (!(p.school !== null && !ph.has(p.school.trim()))) return false;
    }

    if (filters.subjects.length > 0) {
      const studentSubjects = subjectIndex.get(p.id);
      if (!studentSubjects || studentSubjects.size === 0) return false;
      const hit = filters.subjects.some((s) => studentSubjects.has(s));
      if (!hit) return false;
    }

    // 지역 필터 — student_profiles.region 정확 일치 (Supabase 와 동일).
    // dev-seed 의 region 은 NOT NULL 이라 단순 includes 로 충분.
    if (filters.regions.length > 0) {
      if (!filters.regions.includes(p.region)) return false;
    }

    return true;
  });
}

/**
 * 강좌별 제외 (dev-seed) — 제외 대상 student_id set 산출.
 *
 * Supabase 경로는 crm_classes.id → aca_class_id → crm_enrollments 로 매핑하지만
 * dev-seed 엔 crm_classes 시드가 없어 변환 불가. DEV_ENROLLMENTS 의 aca_class_id
 * 인덱스로 직접 매칭한다 (excludeClassIds 를 aca_class_id 로 간주하는 best-effort).
 * 시드 enrollment 의 aca_class_id 는 모두 NULL 이라 실제 매칭 0명 — "aca_class_id
 * NULL 은 매칭 0명" 계약과 일치.
 */
function buildDevExcludeClassStudentSet(
  excludeClassIds: readonly string[],
): Set<string> {
  const wanted = new Set(excludeClassIds);
  const result = new Set<string>();
  for (const e of DEV_ENROLLMENTS) {
    if (e.aca_class_id !== null && wanted.has(e.aca_class_id)) {
      result.add(e.student_id);
    }
  }
  return result;
}

/**
 * DEV_ENROLLMENTS → `Map<student_id, Set<Subject>>`.
 * 호출마다 재계산이나, 시드 크기가 수십건이라 무시 가능.
 */
function buildDevSubjectIndex(): Map<string, Set<Subject>> {
  const idx = new Map<string, Set<Subject>>();
  for (const e of DEV_ENROLLMENTS) {
    if (!e.subject) continue;
    const set = idx.get(e.student_id) ?? new Set<Subject>();
    set.add(e.subject);
    idx.set(e.student_id, set);
  }
  return idx;
}
