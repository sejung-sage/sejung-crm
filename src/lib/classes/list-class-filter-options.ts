import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";

/**
 * 강좌 리스트 필터의 강사 옵션을 prefetch 한다.
 *
 * 사용처: `/classes` Server Component 가 호출 → `ClassesToolbar` 의
 * `teacherOptions` prop 으로 전달.
 *
 * 학생 리스트의 `listStudentFilterOptions` 미러링이지만, 강좌 테이블은
 * 6,000행 정도로 학생(60,000) 대비 1/10 규모라 페이지네이션 부담이 작다.
 * 한 번의 1만 행 스캔으로 충분.
 *
 * RLS:
 *  - branch 인자가 있고 "전체" 가 아니면 WHERE 로 분원 제한.
 *  - 그 외는 RLS 자체가 가시성을 좁힘.
 *
 * dev-seed 모드: 강좌 시드가 비어 있어 빈 배열 반환.
 */

const PAGE_SIZE = 1000;
const MAX_PAGES = 10; // 안전상한 — 1만 행. 강좌 6,000 규모 + 분원 필터 시 충분.

export interface ClassFilterOptions {
  /** 강사명 (오름차순). 빈 문자열·null 제외. */
  teachers: string[];
}

export async function listClassFilterOptions(
  branch: string | undefined,
): Promise<ClassFilterOptions> {
  if (isDevSeedMode()) {
    // dev seed 에는 강좌 시드가 없어 의미 있는 강사 옵션을 만들 수 없다.
    return { teachers: [] };
  }
  return collectFromSupabase(branch);
}

/**
 * Supabase 행 좁힘용 부분 컬럼 타입.
 * `select("teacher_name")` narrowing 결과가 환경별로 달라 일부 컴파일에서
 * 에러가 나는 케이스가 있어 OptionRow[] 로 안전 캐스팅한다.
 */
interface OptionRow {
  teacher_name: string | null;
}

async function collectFromSupabase(
  branch: string | undefined,
): Promise<ClassFilterOptions> {
  const supabase = await createSupabaseServerClient();
  const teacherSet = new Set<string>();

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from("classes")
      .select("teacher_name")
      .not("teacher_name", "is", null)
      .range(from, to);

    if (branch && branch !== "전체") {
      query = query.eq("branch", branch);
    }

    const { data, error } = await query;
    if (error) {
      // 옵션 prefetch 실패는 페이지 자체를 깨면 안 된다 — 빈 옵션으로 fallback.
      return { teachers: [] };
    }

    const rows = (data ?? []) as unknown as OptionRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      if (typeof row.teacher_name === "string" && row.teacher_name.trim().length > 0) {
        teacherSet.add(row.teacher_name.trim());
      }
    }

    // 더 이상 행이 없으면 조기 종료.
    if (rows.length < PAGE_SIZE) break;
  }

  return {
    teachers: [...teacherSet].sort((a, b) => a.localeCompare(b)),
  };
}
