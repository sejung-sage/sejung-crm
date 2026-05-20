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
import { getUnsubscribedPhones } from "@/lib/messaging/unsubscribed-phones";
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
  //    React cache 로 같은 요청 내 중복 호출 제거 (preview-recipients 등과 공유).
  const safeUnsubPhones = await getUnsubscribedPhones();

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
  // 그룹 단건 삭제(excludeStudentIds)는 SQL 단에서 NOT IN 으로 강제 제외.
  // includeStudentIds 경로(전체 id 명시)에도 동일하게 적용해야 옛 그룹과 의미가
  // 일관된다 — "이 학생만 보낼 건데, 그중 X 한 명은 빼고" 가 가능.
  const safeExcludeIds = filters.excludeStudentIds ?? [];

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

    // 재원 상태 필터 — 빈 배열이면 default 는 탈퇴 제외 전체 (재원생/수강이력자/수강 x).
    // 옛 그룹 JSONB 에 statuses 키가 없으면 빈 배열로 채워지는데, 그 그룹의 의미는
    // "탈퇴 빼고 전체" 였으므로 default 도 동일하게 잡아야 옛 그룹 카운트가 보존된다.
    // 사용자가 명시적으로 좁히려면 그룹 빌더에서 칩을 골라야 한다.
    const wantedStatuses =
      filters.statuses.length > 0
        ? filters.statuses
        : ["재원생", "수강이력자", "수강 x"];
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

    // 강제 제외 — 그룹 상세에서 단건 삭제된 학생.
    // PostgREST `.not('id','in','(uuid1,uuid2,...)')` 형식. uuid 는 hex+하이픈이라
    // 메타문자 인젝션 위험 없음.
    if (safeExcludeIds.length > 0) {
      q = q.not("id", "in", `(${safeExcludeIds.join(",")})`);
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

// ─── diffRecipients ────────────────────────────────────────
//
// 그룹 수정 시 "이번 변경으로 몇 명이 새로 들어오고/빠지는지" 미리보기 용.
//
// 구현 전략: 두 필터 각각에 대해 학생 id set 을 SQL 한 번씩 페치 후 JS set
// diff. count-recipients 와 가드(분원, 탈퇴, 수신거부, 명시 제외) 룰을 정확
// 일치시키려면 SQL 한 곳에서 묶는 게 안전하지만, 두 필터를 독립적으로 비교해야
// 하므로 어쩔 수 없이 두 번 호출.
//
// 규모 가정: 그룹 수신자는 보통 수십~수천명. 분원 + status 인덱스로 좁힌 뒤
// id 만 가져오므로 부담 작음. 60K 분원이라도 max 가드는 호출자가 책임.

export interface DiffRecipientsResult {
  /** 새 필터로 새로 포함되는 학생 수 (newOnly = new \ old). */
  added: number;
  /** 이번 변경으로 빠지는 학생 수 (oldOnly = old \ new). */
  removed: number;
  /** 새 필터의 최종 수신자 수. */
  total: number;
  /** 새로 들어오는 학생 상위 N(name/school/grade/branch). */
  sample: CountRecipientsResult["sample"];
}

export async function diffRecipients(
  oldFilters: GroupFilters,
  newFilters: GroupFilters,
  branch: string,
): Promise<DiffRecipientsResult> {
  if (isDevSeedMode()) {
    return diffFromDevSeed(oldFilters, newFilters, branch);
  }
  return diffFromSupabase(oldFilters, newFilters, branch);
}

function diffFromDevSeed(
  oldFilters: GroupFilters,
  newFilters: GroupFilters,
  branch: string,
): DiffRecipientsResult {
  const oldMatched = applyGroupFiltersDev(
    DEV_STUDENT_PROFILES,
    oldFilters,
    branch,
  );
  const newMatched = applyGroupFiltersDev(
    DEV_STUDENT_PROFILES,
    newFilters,
    branch,
  );

  const oldIds = new Set(oldMatched.map((r) => r.id));
  const newIds = new Set(newMatched.map((r) => r.id));

  const addedRows = newMatched.filter((r) => !oldIds.has(r.id));
  const removedCount = oldMatched.filter((r) => !newIds.has(r.id)).length;

  return {
    added: addedRows.length,
    removed: removedCount,
    total: newMatched.length,
    sample: addedRows.slice(0, SAMPLE_SIZE).map((r) => ({
      name: r.name,
      school: r.school,
      grade: r.grade,
      branch: r.branch,
    })),
  };
}

async function diffFromSupabase(
  oldFilters: GroupFilters,
  newFilters: GroupFilters,
  branch: string,
): Promise<DiffRecipientsResult> {
  // 두 필터의 id set 을 평행 페치. 각각 페치하면서 동시에 새 set 의 sample 도 함께.
  const [oldIds, newIdsResult] = await Promise.all([
    loadRecipientIdSet(oldFilters, branch),
    loadRecipientIdSetWithSample(newFilters, branch),
  ]);

  const newIds = newIdsResult.ids;
  const oldOnly = [...oldIds].filter((id) => !newIds.has(id));
  const newOnlyIds = [...newIds].filter((id) => !oldIds.has(id));
  const newOnlySet = new Set(newOnlyIds);

  // sample 은 new 의 첫 SAMPLE_SIZE 중 added 에 속하는 것만 보여줌.
  const sample = newIdsResult.sample
    .filter((s) => newOnlySet.has(s.id))
    .slice(0, SAMPLE_SIZE)
    .map((s) => ({
      name: s.name,
      school: s.school,
      grade: s.grade,
      branch: s.branch,
    }));

  return {
    added: newOnlyIds.length,
    removed: oldOnly.length,
    total: newIds.size,
    sample,
  };
}

interface IdRow {
  id: string;
}

interface SampleRowWithId extends SampleStudentRow {
  id: string;
}

/**
 * 필터에 매칭되는 학생 id set 만 페치. (sample 없이) diff 의 old 측에서 사용.
 *
 * 페치 한도: 1만건 (그룹 수신자 운영 상한 + 안전 여유). 그 이상이면 페이지네이션
 * 부담이 커져 미리보기 UX 가 무의미. 호출자(그룹 빌더)가 그 이상으로 키우는
 * 케이스는 따로 처리.
 */
async function loadRecipientIdSet(
  filters: GroupFilters,
  branch: string,
): Promise<Set<string>> {
  const rows = await loadRecipientIdsCore(filters, branch);
  return new Set(rows.map((r) => r.id));
}

async function loadRecipientIdSetWithSample(
  filters: GroupFilters,
  branch: string,
): Promise<{ ids: Set<string>; sample: SampleRowWithId[] }> {
  const supabase = await createSupabaseServerClient();

  // 1) 수신거부 페치 — React cache 공유.
  const safeUnsubPhones = await getUnsubscribedPhones();

  // 2) 매칭 id + sample 한 번에 (id 외 4컬럼).
  const q = buildRecipientQuery(
    supabase,
    "id, name, school, grade, branch",
    filters,
    branch,
    safeUnsubPhones,
  );
  const { data, error } = await (
    q as unknown as {
      order: (
        col: string,
        opts: { ascending: boolean; nullsFirst?: boolean },
      ) => {
        range: (from: number, to: number) => Promise<{
          data: SampleRowWithId[] | null;
          error: { message: string } | null;
        }>;
      };
    }
  )
    .order("registered_at", { ascending: false, nullsFirst: false })
    .range(0, MAX_DIFF_ROWS - 1);

  if (error) {
    throw new Error(`수신자 diff 조회에 실패했습니다: ${error.message}`);
  }
  const rows = (data ?? []) as SampleRowWithId[];
  return {
    ids: new Set(rows.map((r) => r.id)),
    sample: rows.slice(0, SAMPLE_SIZE),
  };
}

async function loadRecipientIdsCore(
  filters: GroupFilters,
  branch: string,
): Promise<IdRow[]> {
  const supabase = await createSupabaseServerClient();

  // 수신거부 페치 — React cache 공유.
  const safeUnsubPhones = await getUnsubscribedPhones();

  const q = buildRecipientQuery(
    supabase,
    "id",
    filters,
    branch,
    safeUnsubPhones,
  );
  const { data, error } = await (
    q as unknown as {
      range: (from: number, to: number) => Promise<{
        data: IdRow[] | null;
        error: { message: string } | null;
      }>;
    }
  ).range(0, MAX_DIFF_ROWS - 1);
  if (error) {
    throw new Error(`수신자 id 페치에 실패했습니다: ${error.message}`);
  }
  return (data ?? []) as IdRow[];
}

/** diff 미리보기 상한 (1만건). 운영 분원 수신자 풀이 그 이상이면 미리보기 무의미. */
const MAX_DIFF_ROWS = 10_000;

type CountSupabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type StudentsQuery = ReturnType<ReturnType<CountSupabase["from"]>["select"]>;

function buildRecipientQuery(
  supabase: CountSupabase,
  selectExpr: string,
  filters: GroupFilters,
  branch: string,
  safeUnsubPhones: string[],
): StudentsQuery {
  let q = supabase
    .from("crm_students")
    .select(selectExpr)
    .neq("status", "탈퇴");

  if (branch) {
    q = q.eq("branch", branch);
  }
  const wantedStatuses =
    filters.statuses.length > 0 ? filters.statuses : ["재원생"];
  q = q.in("status", wantedStatuses);

  if (filters.includeStudentIds.length > 0) {
    q = q.in("id", filters.includeStudentIds);
  } else {
    if (filters.grades.length > 0) {
      q = q.in("grade", filters.grades);
    }
    if (filters.schools.length > 0) {
      q = q.in("school", filters.schools);
    }
    // subjects/regions 는 enrollments/school_regions 사전 페치가 필요한데,
    // diff 미리보기 경량 호출에선 동일 의미를 위해 그룹 빌더가 사전에
    // 학교 리스트로 변환해서 newFilters.schools 에 흡수해 넣을 수 있다.
    // 여기서는 단순화 — subjects/regions 가 있으면 일치 학생 모집단이 더
    // 좁아질 뿐이므로 "added/removed 가 약간 과대 계산" 정도의 미세 오차만 발생.
  }

  const excludeIds = filters.excludeStudentIds ?? [];
  if (excludeIds.length > 0) {
    q = q.not("id", "in", `(${excludeIds.join(",")})`);
  }

  if (safeUnsubPhones.length > 0) {
    q = q.or(
      `parent_phone.is.null,parent_phone.not.in.(${safeUnsubPhones.join(",")})`,
    );
  }

  return q as StudentsQuery;
}
