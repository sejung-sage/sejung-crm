/**
 * F2 · 발송 그룹 상세 · 수신자 전체 목록 (페이지네이션)
 *
 * 그룹 id 로 필터를 꺼내 동일한 자동 제외 규칙을 적용한 수신자 목록을 반환.
 * - dev-seed: `applyGroupFiltersDev` 재사용
 * - Supabase: `count-recipients.ts` 와 같은 분기 정책 (includeStudentIds 우선)
 *
 * 쿼리 전략 (statement timeout 해소 — 4만+ 학생 규모):
 *   `student_profiles` 뷰는 crm_students + crm_enrollments + crm_attendances +
 *   crm_school_regions 풀 집계 (LEFT JOIN + GROUP BY). 4만+ 학생 × 수만
 *   attendance 를 매번 집계하면 8s statement_timeout 초과 → 그룹 상세가
 *   "일시적인 오류" 페이지로 떨어진다.
 *
 *   count-recipients 와 동일한 두 단계 패턴 적용:
 *     1) count + page 는 crm_students 직접 쿼리 (0046 인덱스 활용, view 우회)
 *     2) 표시 슬라이스(50명) 만 enrollments+classes 페치해 subjects/teachers 보강
 *
 *   집계 필드 (enrollment_count, active_enrollment_count, total_paid,
 *   last_*_at) 는 현재 그룹 상세 UI(group-students-table)가 사용하지 않으므로
 *   0/null 로 채워 반환한다. 추후 표시 필요 시 별도 페치 추가.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  StudentProfileRow,
  Subject,
  Grade,
  StudentStatus,
} from "@/types/database";
import {
  DEV_STUDENT_PROFILES,
  isDevSeedMode,
} from "@/lib/profile/students-dev-seed";
import { applyGroupFiltersDev } from "./apply-filters";
import { getGroup } from "./get-group";
// 학생 명단·count-recipients 와 동일 로직 보장 — 학교 미등록/등록 토글.
import {
  UNMAPPED_SCHOOL_OR_EXPR,
  applyMappedSchoolFilter,
} from "@/lib/profile/list-students";
import { getUnsubscribedPhones } from "@/lib/messaging/unsubscribed-phones";
import { isAllSubjects } from "@/lib/schemas/common";

const PAGE_SIZE = 50;

export interface ListGroupStudentsQuery {
  page?: number;
}

export interface ListGroupStudentsResult {
  items: StudentProfileRow[];
  total: number;
}

export async function listGroupStudents(
  groupId: string,
  query: ListGroupStudentsQuery,
): Promise<ListGroupStudentsResult> {
  const group = await getGroup(groupId);
  if (!group) {
    return { items: [], total: 0 };
  }
  const page = Math.max(1, query.page ?? 1);

  if (isDevSeedMode()) {
    const matched = applyGroupFiltersDev(
      DEV_STUDENT_PROFILES,
      group.filters,
      group.branch,
    );
    const from = (page - 1) * PAGE_SIZE;
    return {
      items: matched.slice(from, from + PAGE_SIZE),
      total: matched.length,
    };
  }

  const supabase = await createSupabaseServerClient();

  // 수신거부 phone — React cache 공유.
  const safeUnsubPhones = await getUnsubscribedPhones();

  // subjects 사전 매핑 — ETL 상 enrollments.subject 가 NULL 이라
  // classes.subject 로 aca_class_id → enrollments.student_id 두 단계 매핑.
  // count-recipients 와 동일 정책.
  let subjectMatchedStudentIds: string[] | null = null;
  if (
    group.filters.includeStudentIds.length === 0 &&
    group.filters.subjects.length > 0 &&
    !isAllSubjects(group.filters.subjects)
  ) {
    // 7종 전체 = "조건 없음" 정규화 (count-recipients 와 동일 정책).
    const { data: classRows, error: classErr } = await supabase
      .from("crm_classes")
      .select("aca_class_id")
      .in("subject", group.filters.subjects)
      .not("aca_class_id", "is", null);
    if (classErr) {
      throw new Error(`강좌 조회에 실패했습니다: ${classErr.message}`);
    }
    const acaClassIds = (classRows ?? [])
      .map((r) => (r as { aca_class_id: string | null }).aca_class_id)
      .filter((v): v is string => typeof v === "string" && v.length > 0);
    if (acaClassIds.length === 0) {
      return { items: [], total: 0 };
    }
    const { data: enrollRows, error: enrollErr } = await supabase
      .from("crm_enrollments")
      .select("student_id")
      .in("aca_class_id", acaClassIds);
    if (enrollErr) {
      throw new Error(`수강 정보 조회에 실패했습니다: ${enrollErr.message}`);
    }
    const set = new Set<string>();
    for (const r of (enrollRows ?? []) as { student_id: string }[]) {
      if (r.student_id) set.add(r.student_id);
    }
    if (set.size === 0) {
      return { items: [], total: 0 };
    }
    subjectMatchedStudentIds = Array.from(set);
  }

  // regions 필터 사전 매핑 — crm_school_regions 에서 매칭 school 페치.
  // student_profiles 뷰의 region 컬럼을 우회. count-recipients 와 동일.
  let allowedSchools: string[] | null = null;
  if (
    group.filters.regions.length > 0 &&
    group.filters.includeStudentIds.length === 0
  ) {
    const { data: regionRows, error: regErr } = await supabase
      .from("crm_school_regions")
      .select("school")
      .in("region", group.filters.regions);
    if (regErr) {
      throw new Error(`지역 매핑 조회에 실패했습니다: ${regErr.message}`);
    }
    allowedSchools = (regionRows ?? [])
      .map((r) => (r as { school: string }).school)
      .filter((s): s is string => typeof s === "string" && s.length > 0);
    if (allowedSchools.length === 0) return { items: [], total: 0 };
  }

  // crm_students 직접 쿼리 빌더 — count 와 page 가 동일 조건 공유.
  // 0046 인덱스(branch+status+school_level+grade, school) 활용 → view 풀 집계 회피.
  type StudentsQuery = ReturnType<ReturnType<typeof supabase.from>["select"]>;
  const buildQuery = (
    selectExpr: string,
    options: { count?: "exact"; head?: boolean } = {},
  ): StudentsQuery => {
    let q = supabase
      .from("crm_students")
      .select(selectExpr, options)
      .neq("status", "탈퇴")
      .eq("branch", group.branch);

    // 재원 상태 — count-recipients 와 동일. 빈 배열 default = 탈퇴 빼고 전체.
    const wantedStatuses =
      group.filters.statuses.length > 0
        ? group.filters.statuses
        : ["재원생", "수강이력자", "수강 x"];
    q = q.in("status", wantedStatuses);

    // includeStudentIds 가 있으면 조건 무시.
    if (group.filters.includeStudentIds.length > 0) {
      q = q.in("id", group.filters.includeStudentIds);
    } else {
      if (group.filters.grades.length > 0) {
        q = q.in("grade", group.filters.grades);
      }
      if (group.filters.schools.length > 0) {
        q = q.in("school", group.filters.schools);
      }
      if (subjectMatchedStudentIds) {
        q = q.in("id", subjectMatchedStudentIds);
      }
      if (allowedSchools) {
        q = q.in("school", allowedSchools);
      }
      // 학교 미등록/등록 토글 — count-recipients 와 동일 헬퍼.
      // 두 토글 동시 true 는 unmapped 우선.
      if (group.filters.unmappedSchool) {
        q = q.or(UNMAPPED_SCHOOL_OR_EXPR) as typeof q;
      } else if (group.filters.mappedSchool) {
        q = applyMappedSchoolFilter(q);
      }
    }

    // 그룹 단건 삭제 — 명시 제외 학생.
    const excludeIds = group.filters.excludeStudentIds ?? [];
    if (excludeIds.length > 0) {
      q = q.not("id", "in", `(${excludeIds.join(",")})`);
    }

    // 수신거부 SQL 단 제외
    if (safeUnsubPhones.length > 0) {
      q = q.or(
        `parent_phone.is.null,parent_phone.not.in.(${safeUnsubPhones.join(",")})`,
      );
    }

    return q as StudentsQuery;
  };

  // 1) head + count=exact
  const { count, error: countError } = await buildQuery("id", {
    count: "exact",
    head: true,
  });
  if (countError) {
    throw new Error(
      `그룹 수신자 카운트 조회에 실패했습니다: ${countError.message}`,
    );
  }

  // 2) page slice — 표시에 필요한 crm_students 컬럼만.
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  type PageRow = {
    id: string;
    name: string;
    school: string | null;
    grade: Grade | null;
    grade_raw: string | null;
    school_level: StudentProfileRow["school_level"];
    status: StudentStatus;
    branch: string;
    parent_phone: string | null;
    phone: string | null;
    registered_at: string | null;
  };
  const pageQuery = buildQuery(
    "id, name, school, grade, grade_raw, school_level, status, branch, parent_phone, phone, registered_at",
  );
  const { data: pageData, error: pageError } = await (
    pageQuery as unknown as {
      order: (
        c: string,
        o: { ascending: boolean; nullsFirst?: boolean },
      ) => {
        range: (
          f: number,
          t: number,
        ) => Promise<{
          data: PageRow[] | null;
          error: { message: string } | null;
        }>;
      };
    }
  )
    .order("registered_at", { ascending: false, nullsFirst: false })
    .range(from, to);
  if (pageError) {
    throw new Error(`그룹 수신자 목록 조회에 실패했습니다: ${pageError.message}`);
  }
  const pageRows = (pageData ?? []) as PageRow[];

  // 3) 표시 슬라이스의 subjects/teachers 만 보강 — enrollments+classes 한 번 페치.
  //    50명 학생에 한정되므로 view 풀 집계 대비 쿼리 비용이 작다.
  //    "최근 수강" 표시 (formatRecent: 상위 2개 과목 + 첫 강사) 용도.
  const subjectsByStudent = new Map<string, Subject[]>();
  const teachersByStudent = new Map<string, string[]>();
  if (pageRows.length > 0) {
    const studentIds = pageRows.map((r) => r.id);
    const { data: enrollRows } = await supabase
      .from("crm_enrollments")
      .select("student_id, aca_class_id")
      .in("student_id", studentIds);
    type EnrollRow = { student_id: string; aca_class_id: string | null };
    const enrolls = (enrollRows ?? []) as EnrollRow[];

    const acaClassIds = Array.from(
      new Set(
        enrolls
          .map((e) => e.aca_class_id)
          .filter((v): v is string => typeof v === "string" && v.length > 0),
      ),
    );

    type ClassRow = {
      aca_class_id: string;
      subject: Subject | null;
      teacher: string | null;
    };
    let classMap = new Map<string, ClassRow>();
    if (acaClassIds.length > 0) {
      const { data: classRows } = await supabase
        .from("crm_classes")
        .select("aca_class_id, subject, teacher")
        .in("aca_class_id", acaClassIds);
      classMap = new Map(
        ((classRows ?? []) as ClassRow[]).map((c) => [c.aca_class_id, c]),
      );
    }

    for (const e of enrolls) {
      if (!e.aca_class_id) continue;
      const cls = classMap.get(e.aca_class_id);
      if (!cls) continue;
      if (cls.subject) {
        const arr = subjectsByStudent.get(e.student_id) ?? [];
        if (!arr.includes(cls.subject)) arr.push(cls.subject);
        subjectsByStudent.set(e.student_id, arr);
      }
      if (cls.teacher) {
        const arr = teachersByStudent.get(e.student_id) ?? [];
        if (!arr.includes(cls.teacher)) arr.push(cls.teacher);
        teachersByStudent.set(e.student_id, arr);
      }
    }
  }

  // 4) StudentProfileRow shape 으로 매핑. UI 미사용 집계 필드는 0/null 채움.
  const items: StudentProfileRow[] = pageRows.map((r) => ({
    id: r.id,
    name: r.name,
    school: r.school,
    grade: r.grade,
    grade_raw: r.grade_raw,
    school_level: r.school_level,
    status: r.status,
    branch: r.branch,
    parent_phone: r.parent_phone,
    phone: r.phone,
    registered_at: r.registered_at,
    enrollment_count: 0,
    active_enrollment_count: 0,
    total_paid: 0,
    subjects: subjectsByStudent.get(r.id) ?? null,
    teachers: teachersByStudent.get(r.id) ?? null,
    last_attended_at: null,
    last_paid_at: null,
    region: "기타",
  }));

  return {
    items,
    total: count ?? 0,
  };
}
