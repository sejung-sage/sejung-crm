/**
 * F2 · 발송 그룹 수신자 카운트 (+ 상위 5명 미리보기)
 *
 * UI 의 필터 조작에 디바운스로 호출되는 경량 쿼리. 발송 시점에도 최종 카운트 확인에 재사용.
 *
 * 자동 제외 규칙 (사용자 확정 · MVP Phase 0):
 *   - students.status = '탈퇴' 제외
 *   - unsubscribes 에 학부모 번호 있는 학생 제외
 *   - "최근 3회 수신자 제외" 는 Phase 1 로 미룸 (여기서 다루지 않음)
 *
 * 수신자 산정 규칙:
 *   - filters.includeStudentIds 가 비어있지 않으면 → 그 학생들만 (조건 무시)
 *   - 비어있으면 → grades/schools/subjects/regions 조건 매치
 *   분원·탈퇴·수신거부 가드는 두 경우 모두 적용.
 *
 * 쿼리 전략 (statement timeout 해소 — 4만+ 학생 규모):
 *   `student_profiles` 뷰는 crm_students + crm_enrollments + crm_attendances +
 *   crm_school_regions 풀 집계 (LEFT JOIN + GROUP BY). 45K 학생 × 수만 attendance
 *   를 매번 집계하면 8s statement_timeout 초과.
 *
 *   - crm_students 인덱스 (0046: branch+status+school_level+grade, school) 위에서 직접 쿼리.
 *   - subjects 필터: crm_enrollments 에서 매칭 student_id 사전 페치 → in() 적용.
 *   - regions 필터: crm_school_regions 에서 매칭 school 사전 페치 → school in() 적용.
 *   - sample 표시 컬럼 (name/school/grade/branch) 는 crm_students 에 모두 있어 뷰 우회.
 *
 *   수신거부 제외는 SQL 단(.or)에서 동일하게 적용 — JS 단 후처리하면 count 와 sample 의
 *   기준이 어긋남.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { GroupFilters } from "@/lib/schemas/group";
import type { Grade } from "@/types/database";
import {
  DEV_STUDENT_PROFILES,
  isDevSeedMode,
} from "@/lib/profile/students-dev-seed";
import { applyGroupFiltersDev } from "./apply-filters";

export interface CountRecipientsResult {
  total: number;
  sample: Array<{
    name: string;
    school: string | null;
    grade: Grade | null;
    branch: string;
  }>;
}

const SAMPLE_SIZE = 5;

export async function countRecipients(
  filters: GroupFilters,
  branch: string,
): Promise<CountRecipientsResult> {
  if (isDevSeedMode()) {
    return countFromDevSeed(filters, branch);
  }
  return countFromSupabase(filters, branch);
}

function countFromDevSeed(
  filters: GroupFilters,
  branch: string,
): CountRecipientsResult {
  const matched = applyGroupFiltersDev(DEV_STUDENT_PROFILES, filters, branch);
  return {
    total: matched.length,
    sample: matched.slice(0, SAMPLE_SIZE).map(toSampleRow),
  };
}

/** 수신거부 phone 값에 허용할 문자 패턴 (숫자/하이픈만). PostgREST `.or(...)` 인자로 박을 때
 *  콤마/괄호/슬래시 등 메타문자 인젝션을 방지. */
const SAFE_PHONE_PATTERN = /^[\d-]+$/;

interface SampleStudentRow {
  name: string;
  school: string | null;
  grade: Grade | null;
  branch: string;
}

async function countFromSupabase(
  filters: GroupFilters,
  branch: string,
): Promise<CountRecipientsResult> {
  const supabase = await createSupabaseServerClient();

  // 1) 수신거부 학부모 번호 목록 선(先)페치.
  //    크기: 수십~수백 (인입은 회원 옵트아웃 한정).
  const { data: unsubRows, error: unsubError } = await supabase
    .from("crm_unsubscribes")
    .select("phone");
  if (unsubError) {
    throw new Error(
      `수신거부 목록 조회에 실패했습니다: ${unsubError.message}`,
    );
  }
  const safeUnsubPhones = (unsubRows ?? [])
    .map((r) => (r as { phone: string }).phone)
    .filter(
      (v): v is string =>
        typeof v === "string" && v.length > 0 && SAFE_PHONE_PATTERN.test(v),
    );

  // 2) subjects 필터 사전 매핑 — crm_enrollments 에서 매칭 student_id 페치.
  //    student_profiles 뷰의 subjects array_agg + overlaps 대신
  //    enrollments 인덱스로 student_id 만 뽑아 students 에 적용.
  let allowedStudentIds: string[] | null = null;
  if (filters.includeStudentIds.length > 0) {
    allowedStudentIds = filters.includeStudentIds;
  } else if (filters.subjects.length > 0) {
    const { data: enrollRows, error: enrollErr } = await supabase
      .from("crm_enrollments")
      .select("student_id")
      .in("subject", filters.subjects);
    if (enrollErr) {
      throw new Error(`수강 정보 조회에 실패했습니다: ${enrollErr.message}`);
    }
    const set = new Set<string>();
    for (const r of (enrollRows ?? []) as { student_id: string }[]) {
      if (r.student_id) set.add(r.student_id);
    }
    if (set.size === 0) return { total: 0, sample: [] };
    allowedStudentIds = Array.from(set);
  }

  // 3) regions 필터 사전 매핑 — crm_school_regions 에서 매칭 school 페치.
  //    "기타" 칩은 매핑된 region='기타' 학교만 매칭 (단순화). 매핑 없는 학교는 제외.
  //    추후 매핑 없는 학교까지 "기타" 로 포함하려면 별도 IS NULL 분기 필요.
  let allowedSchools: string[] | null = null;
  if (filters.regions.length > 0 && filters.includeStudentIds.length === 0) {
    const { data: regionRows, error: regErr } = await supabase
      .from("crm_school_regions")
      .select("school")
      .in("region", filters.regions);
    if (regErr) {
      throw new Error(`지역 매핑 조회에 실패했습니다: ${regErr.message}`);
    }
    allowedSchools = (regionRows ?? [])
      .map((r) => (r as { school: string }).school)
      .filter((s): s is string => typeof s === "string" && s.length > 0);
    if (allowedSchools.length === 0) return { total: 0, sample: [] };
  }

  // 4) crm_students 쿼리 빌더 — count 와 sample 이 동일 필터를 공유.
  //    student_profiles 뷰 우회 → 0046 인덱스(branch+status+school_level+grade, school) 활용.
  type StudentsQuery = ReturnType<ReturnType<typeof supabase.from>["select"]>;
  function buildQuery(
    selectExpr: string,
    options: { count?: "exact"; head?: boolean } = {},
  ): StudentsQuery {
    // 안전 정책: 탈퇴 학생은 status 필터 선택과 무관하게 항상 차단.
    let q = supabase
      .from("crm_students")
      .select(selectExpr, options)
      .neq("status", "탈퇴");

    if (branch) {
      q = q.eq("branch", branch);
    }

    // 재원 상태 필터 — 빈 배열이면 default '재원생' 만.
    const wantedStatuses =
      filters.statuses.length > 0 ? filters.statuses : ["재원생"];
    q = q.in("status", wantedStatuses);

    if (allowedStudentIds) {
      q = q.in("id", allowedStudentIds);
    } else {
      if (filters.grades.length > 0) {
        q = q.in("grade", filters.grades);
      }
      if (filters.schools.length > 0) {
        q = q.in("school", filters.schools);
      }
      if (allowedSchools) {
        q = q.in("school", allowedSchools);
      }
    }

    if (safeUnsubPhones.length > 0) {
      q = q.or(
        `parent_phone.is.null,parent_phone.not.in.(${safeUnsubPhones.join(",")})`,
      );
    }

    return q as StudentsQuery;
  }

  // 5) 카운트 — head + count=exact 로 헤더만.
  const { count, error: countError } = await buildQuery("id", {
    count: "exact",
    head: true,
  });
  if (countError) {
    throw new Error(
      `수신자 카운트 조회에 실패했습니다: ${countError.message}`,
    );
  }

  // 6) 샘플 — 상위 5명. 표시 필드는 crm_students 컬럼만 사용 (뷰 우회).
  const sampleQuery = buildQuery(
    "name, school, grade, branch",
  );
  const { data: sampleData, error: sampleError } = await (
    sampleQuery as unknown as {
      order: (
        col: string,
        opts: { ascending: boolean; nullsFirst?: boolean },
      ) => {
        limit: (n: number) => Promise<{
          data: SampleStudentRow[] | null;
          error: { message: string } | null;
        }>;
      };
    }
  )
    .order("registered_at", { ascending: false, nullsFirst: false })
    .limit(SAMPLE_SIZE);

  if (sampleError) {
    throw new Error(`수신자 조회에 실패했습니다: ${sampleError.message}`);
  }

  return {
    total: count ?? 0,
    sample: (sampleData ?? []).map(toSampleRow),
  };
}

function toSampleRow(p: SampleStudentRow): {
  name: string;
  school: string | null;
  grade: Grade | null;
  branch: string;
} {
  return {
    name: p.name,
    school: p.school,
    grade: p.grade,
    branch: p.branch,
  };
}
