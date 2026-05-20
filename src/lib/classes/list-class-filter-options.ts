import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import type { ClassFilters } from "@/lib/schemas/class";

/**
 * 강좌 리스트 필터의 강사 옵션을 prefetch 한다.
 *
 * 사용처: `/classes` Server Component 가 호출 → `ClassesToolbar` 의
 * `teacherOptions` prop 으로 전달.
 *
 * **현재 적용된 필터를 동일하게 반영한 결과의 distinct teacher_name 만 반환**.
 * 즉 사용자가 분원·과목·기간·status 등을 좁히면 강사 드롭다운 옵션도 그 좁힘에
 * 매칭되는 강좌의 강사만 보여 "선택해도 0건" 인 죽은 옵션이 줄어든다.
 *
 * ※ 단 `teachers` 필터 자체는 옵션 prefetch 에서 적용하지 않는다 — 자기 자신을
 *    좁히면 "한 명 선택하면 다른 사람이 사라지는" 모순이 생기기 때문 (학생 리스트
 *    필터 옵션과 동일 정책).
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

/**
 * 종강·폐강 prefix 4종 — `list-classes.ts` 와 동일.
 * status="progressing" 분기 적용 시 옵션 prefetch 에서도 동일하게 가드한다.
 */
const GRADUATED_NAME_PREFIXES = ["(종)", "종)", "(폐)", "폐)"] as const;

/**
 * "오늘" KST 'YYYY-MM-DD' — list-classes 와 동일 로직.
 * (코드 중복은 작고 책임 경계가 분명해 헬퍼 분리는 생략.)
 */
function todayKstDateString(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function listClassFilterOptions(
  filters: ClassFilters | undefined,
): Promise<ClassFilterOptions> {
  if (isDevSeedMode()) {
    // dev seed 에는 강좌 시드가 없어 의미 있는 강사 옵션을 만들 수 없다.
    return { teachers: [] };
  }
  return collectFromSupabase(filters);
}

/**
 * Supabase 행 좁힘용 부분 컬럼 타입.
 * `select("teacher_name")` narrowing 결과가 환경별로 달라 일부 컴파일에서
 * 에러가 나는 케이스가 있어 OptionRow[] 로 안전 캐스팅한다.
 */
interface OptionRow {
  teacher_name: string | null;
}

/**
 * 기간 필터가 있으면 aca_tickets 에서 distinct aca_class_id 셋을 먼저 모은다.
 * list-classes.ts 의 `fetchClassIdsInTicketDateRange` 와 동일 로직 — 옵션 prefetch
 * 에도 같은 좁힘을 일관 적용하기 위해 별도 구현(중복 작지만 책임 명확).
 */
async function fetchTicketClassIdsForOptions(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  filters: ClassFilters,
): Promise<string[]> {
  const TPAGE_SIZE = 1000;
  const TMAX_PAGES = 50;
  const TMAX_DISTINCT = 10_000;
  const set = new Set<string>();

  for (let page = 0; page < TMAX_PAGES; page++) {
    const from = page * TPAGE_SIZE;
    const to = from + TPAGE_SIZE - 1;

    let q = supabase
      .from("aca_tickets")
      .select("aca_class_id")
      .not("aca_class_id", "is", null)
      .range(from, to);
    if (filters.startDate) q = q.gte("class_date", filters.startDate);
    if (filters.endDate) q = q.lte("class_date", filters.endDate);
    if (filters.branch && filters.branch !== "") {
      q = q.eq("branch", filters.branch);
    }

    const { data, error } = await q;
    if (error) {
      // 옵션 prefetch 실패는 페이지를 깨지 않는다 — 빈 셋으로 fallback.
      return [];
    }
    const rows = (data ?? []) as Array<{ aca_class_id: string | null }>;
    if (rows.length === 0) break;
    for (const row of rows) {
      if (typeof row.aca_class_id === "string" && row.aca_class_id.length > 0) {
        set.add(row.aca_class_id);
        if (set.size >= TMAX_DISTINCT) return [...set];
      }
    }
    if (rows.length < TPAGE_SIZE) break;
  }
  return [...set];
}

async function collectFromSupabase(
  filters: ClassFilters | undefined,
): Promise<ClassFilterOptions> {
  const supabase = await createSupabaseServerClient();
  const teacherSet = new Set<string>();

  // 기간 필터 적용 — ticket 매칭 강좌 ID 셋 prefetch. 셋이 비면 옵션도 0건.
  let ticketClassIds: string[] | undefined;
  if (filters && (filters.startDate || filters.endDate)) {
    ticketClassIds = await fetchTicketClassIdsForOptions(supabase, filters);
    if (ticketClassIds.length === 0) {
      return { teachers: [] };
    }
  }

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from("crm_classes")
      .select("teacher_name")
      .not("teacher_name", "is", null)
      .range(from, to);

    if (filters?.branch && filters.branch !== "" && filters.branch !== "전체") {
      query = query.eq("branch", filters.branch);
    }

    if (filters?.subject) {
      query = query.eq("subject", filters.subject);
    }

    if (filters?.active === true) {
      query = query.eq("active", true);
    }

    // status — list-classes.ts 의 applyClassFilters 와 동일 룰.
    // (teachers 필터 본인은 자기 좁힘 모순이라 적용 X.)
    if (filters?.status === "progressing") {
      const today = todayKstDateString();
      query = query.or(`end_date.is.null,end_date.gte.${today}`);
      for (const prefix of GRADUATED_NAME_PREFIXES) {
        query = query.not("name", "ilike", `${prefix}%`);
      }
      query = query.or("subject.is.null,subject.neq.설명회");
    } else if (filters?.status === "seminar") {
      query = query.eq("subject", "설명회");
    } else if (filters?.status === "graduated") {
      const today = todayKstDateString();
      const orParts = [
        `end_date.lt.${today}`,
        ...GRADUATED_NAME_PREFIXES.map((p) => `name.ilike."${p}%"`),
      ];
      query = query.or(orParts.join(","));
    }

    // 요일 다중 필터 — schedule_days substring OR.
    if (filters?.days && filters.days.length > 0) {
      const orParts = filters.days
        .map((d) => `schedule_days.ilike.%${d}%`)
        .join(",");
      query = query.or(orParts);
    }

    // 기간 ticketClassIds — 미리 모아둔 셋으로 좁힘.
    if (ticketClassIds && ticketClassIds.length > 0) {
      query = query.in("aca_class_id", ticketClassIds);
    }

    // search 는 옵션 prefetch 에서 굳이 적용할 필요 없음 (반명/강사명 검색은
    // 강사 옵션 좁힘 의도와 직결되지 않음). 학생 리스트 옵션과 동일 정책.

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
