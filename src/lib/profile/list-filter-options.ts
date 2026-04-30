import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  DEV_ENROLLMENTS,
  DEV_STUDENT_PROFILES,
  isDevSeedMode,
} from "./students-dev-seed";

/**
 * 학생 리스트 필터의 강사·학교 옵션을 prefetch 한다.
 *
 * 사용처: `/students` Server Component 가 호출 → 결과를 `StudentsFilters` 에
 * `teacherOptions` / `schoolOptions` prop 으로 전달.
 *
 * RLS: master 가 아니면 본인 분원의 강사·학교만 보이는 것이 자연스러우므로
 *  - branch 인자가 있으면 (and "전체" 가 아니면) WHERE 로 제한.
 *  - branch 가 없거나 "전체" 면 RLS 자체가 가시성을 알아서 좁힘.
 *
 * 6만 학생 테이블이라 distinct 풀 스캔은 무겁다. 단계적 최적화:
 *  1) (현재) student_profiles 에서 teachers / school 만 select 후
 *     클라이언트 단에서 flatten + Set + sort. 페이지네이션 1000행 단위.
 *  2) (TODO) 향후 RPC `list_distinct_teachers_and_schools(branch text)` 를
 *     만들어 PG 단에서 distinct + sort 하면 네트워크/메모리 모두 절감.
 *
 * dev-seed 모드에서는 인메모리 시드에서 flatten + Set 으로 구성.
 */

const PAGE_SIZE = 1000;
const MAX_PAGES = 10; // 안전상한 — 1만 행까지만 스캔. 분원 필터 적용 시 충분.

export interface StudentFilterOptions {
  /** 강사명 (오름차순). 빈 문자열·null 제외. */
  teachers: string[];
  /** 학교명 (오름차순). 빈 문자열·null 제외. */
  schools: string[];
}

export async function listStudentFilterOptions(
  branch: string | undefined,
): Promise<StudentFilterOptions> {
  if (isDevSeedMode()) {
    return collectFromDevSeed(branch);
  }
  return collectFromSupabase(branch);
}

/**
 * 옵션 prefetch 결과 행 타입.
 * student_profiles 뷰의 부분 컬럼만 사용하므로, 좁힌 타입으로 캐스팅.
 */
interface OptionRow {
  teachers: string[] | null;
  school: string | null;
}

async function collectFromSupabase(
  branch: string | undefined,
): Promise<StudentFilterOptions> {
  const supabase = await createSupabaseServerClient();

  const teacherSet = new Set<string>();
  const schoolSet = new Set<string>();

  // 단일 쿼리로 모은다. 학생이 6만 명이라도 teachers/school 두 컬럼만
  // 가져오므로 페이로드는 가벼움. 분원 필터가 있으면 더더욱 가벼움.
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from("student_profiles")
      .select("teachers, school")
      .range(from, to);

    if (branch && branch !== "전체") {
      query = query.eq("branch", branch);
    }

    const { data, error } = await query;
    if (error) {
      // 옵션 prefetch 실패는 페이지 자체를 깨면 안 된다 — 빈 옵션으로 fallback.
      // 사용자는 다른 필터로 학생 리스트를 볼 수 있어야 함.
      return {
        teachers: [],
        schools: [],
      };
    }

    // supabase-js 의 `select("teachers, school")` narrowing 결과가 환경별로
    // 달라 컴파일 에러가 나는 케이스가 있다. 부분 컬럼 select 이므로
    // 안전하게 OptionRow[] 로 좁힌다 (런타임 가드는 아래 in-place 체크).
    const rows = (data ?? []) as unknown as OptionRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      // teachers 는 text[] (집계 결과). null / 빈 배열 가드.
      if (Array.isArray(row.teachers)) {
        for (const t of row.teachers) {
          if (typeof t === "string" && t.trim().length > 0) {
            teacherSet.add(t.trim());
          }
        }
      }
      // school 은 단일 text. 빈 문자열 컷.
      if (typeof row.school === "string" && row.school.trim().length > 0) {
        schoolSet.add(row.school.trim());
      }
    }

    // 더 이상 행이 없으면 조기 종료.
    if (rows.length < PAGE_SIZE) break;
  }

  return {
    teachers: [...teacherSet].sort((a, b) => a.localeCompare(b)),
    schools: [...schoolSet].sort((a, b) => a.localeCompare(b)),
  };
}

function collectFromDevSeed(
  branch: string | undefined,
): StudentFilterOptions {
  const teacherSet = new Set<string>();
  const schoolSet = new Set<string>();

  const profiles =
    branch && branch !== "전체"
      ? DEV_STUDENT_PROFILES.filter((r) => r.branch === branch)
      : DEV_STUDENT_PROFILES;

  for (const r of profiles) {
    if (Array.isArray(r.teachers)) {
      for (const t of r.teachers) {
        if (typeof t === "string" && t.trim().length > 0) {
          teacherSet.add(t.trim());
        }
      }
    }
    if (typeof r.school === "string" && r.school.trim().length > 0) {
      schoolSet.add(r.school.trim());
    }
  }

  // 시드 profile.teachers 가 비어있을 수 있어 enrollments 도 보조 수집.
  const studentIdsInBranch = new Set(profiles.map((p) => p.id));
  for (const e of DEV_ENROLLMENTS) {
    if (!studentIdsInBranch.has(e.student_id)) continue;
    if (typeof e.teacher_name === "string" && e.teacher_name.trim().length > 0) {
      teacherSet.add(e.teacher_name.trim());
    }
  }

  return {
    teachers: [...teacherSet].sort((a, b) => a.localeCompare(b)),
    schools: [...schoolSet].sort((a, b) => a.localeCompare(b)),
  };
}
