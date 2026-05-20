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
import type { StudentProfileRow, Subject } from "@/types/database";
import { DEV_ENROLLMENTS } from "@/lib/profile/students-dev-seed";

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

  // 직접 선택한 학생 ID set (있으면 조건 무시)
  const includeSet =
    filters.includeStudentIds.length > 0
      ? new Set(filters.includeStudentIds)
      : null;

  return profiles.filter((p) => {
    // 1) 분원
    if (branchTrim && p.branch !== branchTrim) return false;

    // 2) 비활성(탈퇴) 제외 — 안전 정책상 status 필터 값과 무관하게 항상 차단.
    if (p.status === "탈퇴") return false;

    // 3) 수신거부 제외 (학부모 연락처 기준)
    if (p.parent_phone && unsub.has(p.parent_phone)) return false;

    // 4) 직접 선택 모드 — includeStudentIds 만 매칭, 조건 절 무시.
    if (includeSet) {
      return includeSet.has(p.id);
    }

    // 5) 재원 상태 — 빈 배열이면 default '재원생' 만 (학생 명단 default 와 동일).
    const wantedStatuses =
      filters.statuses.length > 0 ? filters.statuses : ["재원생"];
    if (!wantedStatuses.includes(p.status)) return false;

    // 6) 조건 절 (직접 선택이 비어있을 때만)
    if (filters.grades.length > 0) {
      if (p.grade === null) return false;
      if (!filters.grades.includes(p.grade)) return false;
    }

    if (filters.schools.length > 0) {
      if (!p.school) return false;
      if (!filters.schools.includes(p.school)) return false;
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
