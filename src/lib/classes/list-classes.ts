/**
 * F0 · 강좌 리스트 (/classes) 데이터 조회
 *
 * 학생 리스트(`@/lib/profile/list-students`) 의 패턴을 그대로 미러링하되,
 * 강좌별 수강생 수 집계를 위해 enrollments 2차 쿼리를 더한다.
 *
 * 쿼리 구조 (PostgREST `max_rows = 1000` cap 회피 + 페이지네이션):
 *   1) classes 카운트 쿼리 — head + count=exact, 모든 필터 적용. body 없음.
 *   2) classes 페이지 쿼리 — 동일 필터 + range(offset, offset+pageSize-1) + 정렬.
 *   3) 페이지의 aca_class_id 들로 enrollments 한 번 조회 →
 *      JS 에서 Map<aca_class_id, Set<student_id>> 로 distinct count 집계.
 *
 * 정렬 정책 (사용자 확정 · `ClassSort` 15종 enum):
 *   - default               : branch ASC > subject ASC NULLS LAST > name ASC (현행)
 *   - registered_desc/asc   : 등록일 (NULLS LAST)
 *   - start_date_desc/asc   : 개강일 (NULLS LAST) + name ASC tiebreak
 *   - end_date_desc/asc     : 종강일 (NULLS LAST) + name ASC tiebreak
 *   - name_asc/desc         : 반명
 *   - capacity_desc         : 정원 많은 순 (NULLS LAST) + name ASC tiebreak
 *   - amount_per_session_*  : 회당단가 (NULLS LAST) + name ASC tiebreak
 *   - total_sessions_desc   : 총회차 (NULLS LAST) + name ASC tiebreak
 *   - enrolled_count_*      : DB 측 집계 컬럼 부재 (페이지 결과에 JS 단 머지) →
 *                             DB 쿼리는 `default` 동일 정렬로 페이지 fetch 후
 *                             JS 단에서 enrolled_student_count 기준 재정렬.
 *                             ※ 페이지 한정 정렬 (페이지네이션 일관성은 깨지나
 *                                집계 컬럼 부재로 인한 자연스러운 한계).
 *
 * NULLS 정책: 학생 리스트와 동일 — 모든 정렬에서 NULL 은 항상 뒤(NULLS LAST).
 *
 * 검색 escape 정책:
 *   - PostgREST `.or(...)` 는 콤마/괄호로 토큰을 분리하므로 사용자 입력에서
 *     `,` 와 `()` 를 제거 (sanitizeSearchTerm). count-recipients.ts 의 phone
 *     정규식 화이트리스트와 같은 정책.
 *   - days 필터는 z.enum(7종 한 글자) 화이트리스트라 메타문자 인젝션 불가.
 *
 * dev seed 모드:
 *   - 학생 dev seed 에는 강좌 시드가 없어 의미 있는 출력을 만들 수 없다.
 *   - 빈 배열 + total=0 으로 단순 반환.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ClassFilters, ClassSort } from "@/lib/schemas/class";
import type { ClassListItem, ClassRow } from "@/types/database";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";

export interface ListClassesResult {
  /** 페이지 행 (수강생 수 집계 포함). */
  rows: ClassListItem[];
  /** 필터 적용 후 전체 매칭 행 수 (페이지네이션용). */
  total: number;
  page: number;
  pageSize: number;
}

/** 페이지 사이즈 상한. Zod 스키마(max 200) 와 같은 값으로 한 번 더 가드. */
const MAX_PAGE_SIZE = 200;

/**
 * 종강·폐강 prefix 4종.
 *
 * 아카2000 동기화 시 종강·폐강된 강좌는 이름 앞에 prefix 가 붙어 들어옴
 * (운영 raw 분포 — 0024/0028 마이그 기준):
 *   - "(종)..." 정상 닫힌 괄호 종강
 *   - "종)..."   앞 괄호 누락된 종강 변형
 *   - "(폐)..." 폐강
 *   - "폐)..."   앞 괄호 누락된 폐강 변형
 *
 * end_date 가 NULL 또는 "2050-01-01" 미정 placeholder 로 박힌 종강 강좌가
 * 진행 중 / 일자 / 월 필터를 통과해 결과에 새는 것을 막기 위한 영구 가드.
 * 향후 동기화로 NULL 인 행이 다시 들어와도 안전.
 */
export const GRADUATED_NAME_PREFIXES = ["(종)", "종)", "(폐)", "폐)"] as const;

/**
 * PostgREST `.or(...)` 인자 인젝션 방어용 sanitizer.
 * - 콤마: OR 절 토큰 구분자 → 제거
 * - 괄호: 그룹/함수 인자 구분자 → 제거
 * 그 외 ilike 메타문자(%, _)는 보존 (와일드카드 매칭 기능).
 */
function sanitizeSearchTerm(s: string): string {
  return s.replace(/[(),]/g, "").trim();
}

/**
 * "오늘"의 KST 날짜 문자열을 'YYYY-MM-DD' 형태로 반환한다.
 *
 * Node 서버는 보통 UTC 로 동작 → `new Date().toISOString().slice(0,10)` 만
 * 쓰면 한국 시간 기준 자정 직후 9시간(또는 그 반대) 윈도우에서 하루가
 * 어긋난다. 학원 운영 기준은 KST 라 진행/종강 분류 경계도 KST 자정이어야
 * 자연스럽다.
 *
 * 구현: `Intl.DateTimeFormat('en-CA', timeZone:'Asia/Seoul')` 는 ko-KR 가
 * 만드는 "2026. 04. 28." 같은 점/공백 포맷이 아닌 ISO 호환 "2026-04-28" 을
 * 그대로 출력해 추가 파싱 없이 PostgREST 인자에 안전하게 넣을 수 있다.
 */
function todayKstDateString(): string {
  // en-CA 로케일은 'YYYY-MM-DD' 포맷을 보장 (ISO 8601 호환).
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function listClasses(
  filters: ClassFilters,
): Promise<ListClassesResult> {
  // dev seed 에는 강좌 시드가 없어 의미 있는 출력을 만들 수 없다.
  // UI 가 빈 상태(0건) 를 그대로 그릴 수 있도록 단순 반환한다.
  if (isDevSeedMode()) {
    return {
      rows: [],
      total: 0,
      page: filters.page,
      pageSize: filters.pageSize,
    };
  }

  return listFromSupabase(filters);
}

async function listFromSupabase(
  filters: ClassFilters,
): Promise<ListClassesResult> {
  const supabase = await createSupabaseServerClient();

  // pageSize clamp (DoS 방어). Zod 스키마에 max=200 있으나 안전하게 한 번 더.
  const pageSize = Math.min(Math.max(filters.pageSize, 1), MAX_PAGE_SIZE);
  const page = Math.max(filters.page, 1);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  // (0) 기간 필터 (startDate/endDate) 가 있으면 aca_tickets 에서 그 기간 안에
  //     class_date(=수업 회차 예정일) 가 1건이라도 있는 distinct aca_class_id 셋을
  //     먼저 모은 뒤, classes 쿼리의 .in('aca_class_id', ids) 로 좁힌다.
  //     운영 기간(start_date/end_date) 무관 — ticket 실제 존재 기준.
  //     셋이 비면 즉시 0건 반환 (불필요한 추가 쿼리 회피).
  let ticketClassIds: string[] | undefined;
  if (filters.startDate || filters.endDate) {
    ticketClassIds = await fetchClassIdsInTicketDateRange(supabase, filters);
    if (ticketClassIds.length === 0) {
      return { rows: [], total: 0, page, pageSize };
    }
  }

  // (1) 카운트 쿼리 + (2) 페이지 쿼리 — 같은 필터를 양쪽에 동일 적용.
  const countQuery = applyClassFilters(
    supabase
      .from("crm_classes")
      .select("id", { count: "exact", head: true }),
    filters,
    ticketClassIds,
  );

  // 정렬은 DB 측(applyClassesSort) 적용 후 .range() 로 페이지 자르기.
  const pageQuery = applyClassesSort(
    applyClassFilters(
      supabase.from("crm_classes").select("*"),
      filters,
      ticketClassIds,
    ),
    filters.sort,
  ).range(from, to);

  const [countResult, pageResult] = await Promise.all([countQuery, pageQuery]);

  if (countResult.error) {
    throw new Error(
      `강좌 목록 카운트에 실패했습니다: ${countResult.error.message}`,
    );
  }
  if (pageResult.error) {
    throw new Error(
      `강좌 목록 조회에 실패했습니다: ${pageResult.error.message}`,
    );
  }

  const total = countResult.count ?? 0;
  const classRows = (pageResult.data ?? []) as ClassRow[];

  // (3) 강좌별 수강생 수 집계.
  //   일반 강좌: aca_class_id 기준 crm_enrollments distinct student_id.
  //   설명회   : 위 ACA 등록 + CRM 자체 신청(crm_class_signup_items status='signed')을
  //              student_id 기준 합집합. 신청 페이지가 없는 일반 강좌는 signup 집합이
  //              비어 결과가 종전과 동일하다. 상세 KPI(class-kpi-cards) 와 같은 정의.
  const [enrolledSetsByAcaId, signupSetsByClassId, codeByClassId] =
    await Promise.all([
      fetchEnrolledStudentSets(supabase, classRows),
      fetchSignupStudentSets(supabase, classRows),
      fetchClassCodes(supabase, classRows),
    ]);

  const rows: ClassListItem[] = classRows.map((c) => ({
    ...c,
    enrolled_student_count: countEnrolledUnion(
      c,
      enrolledSetsByAcaId,
      signupSetsByClassId,
    ),
    lecture_code: codeByClassId.get(c.id) ?? null,
  }));

  // enrolled_count_* 정렬은 DB 측 집계 컬럼이 없어 페이지 fetch 후
  // JS 단에서 한 번 더 정렬한다. 페이지 한정 정렬이라 페이지네이션 전체 일관성은
  // 깨지지만 (다음 페이지의 작은 enrolled_count 가 현재 페이지보다 클 수 있음),
  // 집계 컬럼 부재로 인한 자연스러운 한계 — UX 상 현재 페이지 내 순서만 보정.
  const finalRows = applyEnrolledCountSortInPage(rows, filters.sort);

  return {
    rows: finalRows,
    total,
    page,
    pageSize,
  };
}

/**
 * classes 쿼리에 ClassFilters 를 일관되게 적용.
 * count·page 쿼리 양쪽이 동일한 필터셋을 갖도록 한 곳에 모은다.
 *
 * 제네릭으로 쿼리 빌더 타입을 보존해 호출부의 .order/.range/.select 가
 * 그대로 이어지도록 한다 (any 미사용).
 *
 * `ticketClassIds` (optional):
 *  - startDate/endDate 가 있을 때 호출부가 미리 aca_tickets 에서 모은 distinct
 *    aca_class_id 셋. 여기서는 단순 .in() 로 좁힌다 (좁힘 결과 0 인 경우는
 *    호출부에서 이미 early-return 처리).
 */
function applyClassFilters<Q extends ClassQueryBuilder>(
  query: Q,
  filters: ClassFilters,
  ticketClassIds?: readonly string[],
): Q {
  let q = query;

  if (filters.branch && filters.branch !== "") {
    q = q.eq("branch", filters.branch) as Q;
  }

  if (filters.subject) {
    // DB CHECK 가 7종 enum 이라 안전 (국어/영어/수학/과탐/사탐/컨설팅/기타).
    q = q.eq("subject", filters.subject) as Q;
  }

  // active=true 가 명시되면 미사용 강좌 숨김. false 면 모두 표시 (필터 미적용).
  if (filters.active === true) {
    q = q.eq("active", true) as Q;
  }

  // 진행/설명회/종강 상태 필터 — 오늘(KST) 기준 derive (앱 레이어 통일 룰).
  //  - "progressing" : (end_date IS NULL OR end_date >= 오늘)
  //                    AND name 이 종강 prefix 4종 중 하나로 시작하지 않음
  //                    AND subject <> '설명회'
  //  - "seminar"     : subject = '설명회' 만 (toggle 신규)
  //  - "graduated"   : end_date < 오늘 OR name 이 종강 prefix 4종 중 하나로 시작함
  //                    (호환 — UI 토글에 미노출, 외부 링크 호환만)
  //  - "all"         : 필터 미적용 (분기 진입 안 함)
  //
  // 종강/폐강 prefix 가드:
  //   아카2000 동기화 시 종강·폐강된 강좌는 이름 앞에 prefix 를 붙여 들어옴.
  //   2026-05-07 진단 기준 운영 분포:
  //     - "(종)..."  1,993건 (정상 닫힌 괄호 종강)
  //     - "종)..."     197건 (앞 괄호 누락된 종강 변형)
  //     - "(폐)..."     8건 (폐강)
  //     - "폐)..."     10건 (앞 괄호 누락된 폐강 변형)
  //   네 prefix 모두 "더 이상 진행되지 않는 강좌" 의미이므로 가드에 함께 포함.
  //   classes.end_date 백필이 누락된 행이 진행 중에 노출되는 사고를 막기 위해
  //   이름 prefix 도 종강 판단에 함께 사용한다 (0022/0024/0028 마이그 백필 후에도
  //   향후 동기화로 NULL 인 행이 다시 들어올 수 있어 영구 가드로 둔다).
  //
  // today 는 'YYYY-MM-DD' ISO 포맷 — 콤마/괄호 없어 .or() 인젝션 안전.
  // graduated 분기의 name 패턴은 괄호가 PostgREST reserved char (,.():) 라
  // .or() 표현식에서 따옴표로 감싸 logical operator 로 오인되는 것을 막는다
  // (PostgREST 공식 가이드라인).
  if (filters.status === "progressing") {
    const today = todayKstDateString();
    q = q.or(`end_date.is.null,end_date.gte.${today}`) as Q;
    for (const prefix of GRADUATED_NAME_PREFIXES) {
      q = q.not("name", "ilike", `${prefix}%`) as Q;
    }
    // 설명회·간담회 (subject='설명회' 0058+0062) 는 진행 중 강좌가 아님.
    // "전체" 토글에서는 노출. NULL subject 는 미분류라 일단 진행 중에 포함.
    q = q.or("subject.is.null,subject.neq.설명회") as Q;
  } else if (filters.status === "seminar") {
    // 설명회 토글 — subject = '설명회' 만. 종강/폐강 prefix("(종)" 등 4종) 가 붙은
    // 설명회는 이미 끝난 회차라 발송·조회 대상이 아니므로 제외한다 (2026-06-04 운영
    // 요청). 아카2000 동기화로 닫힌 과거 설명회가 prefix 로 들어와 목록을 채우는 것을
    // 막는다 — "progressing" 가드와 동일한 prefix 룰.
    q = q.eq("subject", "설명회") as Q;
    for (const prefix of GRADUATED_NAME_PREFIXES) {
      q = q.not("name", "ilike", `${prefix}%`) as Q;
    }
  } else if (filters.status === "graduated") {
    const today = todayKstDateString();
    const orParts = [
      `end_date.lt.${today}`,
      ...GRADUATED_NAME_PREFIXES.map((p) => `name.ilike."${p}%"`),
    ];
    q = q.or(orParts.join(",")) as Q;
  }

  // 기간 필터 — startDate/endDate 가 있으면 호출부가 미리 모아둔 ticketClassIds
  // (그 기간 안에 class_date 가 1건이라도 있는 강좌 셋) 로 좁힌다.
  // (caller 가 빈 셋이면 early-return 하므로 여기서 빈 .in 호출은 발생 안 함)
  if (ticketClassIds && ticketClassIds.length > 0) {
    q = q.in("aca_class_id", ticketClassIds) as Q;
  }

  // 강사명 다중 필터 — classes.teacher_name 정확 일치 (IN).
  // 빈 문자열은 schema 단계에서 trim 되었으나 한 번 더 가드.
  if (filters.teachers.length > 0) {
    q = q.in("teacher_name", filters.teachers) as Q;
  }

  // 요일 다중 필터 — schedule_days 가 자유형("화목","월수금","월화수목금" 등
  // 한 글자씩 이어붙임). 선택된 요일 중 하나라도 매칭되면 통과 (OR substring).
  // days 는 z.enum 화이트리스트라 한 글자만 들어오므로 .or 메타문자 인젝션 X.
  if (filters.days.length > 0) {
    const orParts = filters.days
      .map((d) => `schedule_days.ilike.%${d}%`)
      .join(",");
    q = q.or(orParts) as Q;
  }

  if (filters.search && filters.search !== "") {
    const safe = sanitizeSearchTerm(filters.search);
    if (safe.length > 0) {
      const like = `%${safe}%`;
      // 반명 + 강사명 OR 검색.
      q = q.or(`name.ilike.${like},teacher_name.ilike.${like}`) as Q;
    }
  }

  return q;
}

/**
 * Supabase 쿼리에 ClassSort 정렬을 분기 적용한다.
 *
 * NULLS 정책: ASC/DESC 모두 NULL 은 항상 뒤(NULLS LAST). Supabase JS 의
 * `nullsFirst: false` 옵션이 SQL `NULLS LAST` 로 매핑되며, registered_at /
 * capacity / amount_per_session / total_sessions 처럼 NULL 가능 컬럼에서
 * 빈 값을 위로 끌어올리지 않기 위함.
 *
 * tiebreaker 정책:
 *   - default                 : branch ASC > subject ASC NULLS LAST > name ASC (현행 3단)
 *   - registered_*            : 단일 키 (학생 리스트와 동일하게 보조 키 미부여 — 시간 충돌 가능성 낮음)
 *   - start_date_*            : 1차 키 동률 시 name ASC 보조 (개강일 같은 반 다수 — 가나다순 안정화)
 *   - end_date_*              : 1차 키 동률 시 name ASC 보조 (종강일 같은 반 다수 — 가나다순 안정화)
 *   - name_*                  : 단일 키
 *   - capacity/amount/total_* : 1차 키 동률 시 name ASC 보조
 *   - enrolled_count_*        : DB 측은 default 와 동일하게 페이지 fetch 후
 *                               JS 단에서 재정렬 (집계 컬럼 부재로 인한 한계).
 *
 * 제네릭 제약은 우리가 호출하는 .order 시그니처만 노출하는 minimal 인터페이스
 * 로 좁혀, any 없이 호출부 빌더 타입을 보존한다.
 */
function applyClassesSort<Q extends ClassesOrderBuilder>(
  query: Q,
  sort: ClassSort,
): Q {
  switch (sort) {
    case "default":
      // 2026-05-19 변경 — 최근 등록 강좌가 위로.
      //   1차: registered_at DESC NULLS LAST (아카 등록일 — 가장 최근 동기화된 반)
      //   2차: created_at DESC (동일 등록일 다수 시 우리 DB 적재 시점으로 안정 정렬)
      // 기존 (branch > subject > name) 정렬은 학생이 직접 분원·과목·반명을 보면서
      // 찾을 때는 적합하나, 새 강좌가 들어왔는지 확인하는 행정 관점에서는
      // 가장 최근 등록 강좌가 위에 보이는 편이 자연스럽다.
      return query
        .order("registered_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false, nullsFirst: false }) as Q;

    case "registered_desc":
      // 최근 등록순.
      return query.order("registered_at", {
        ascending: false,
        nullsFirst: false,
      }) as Q;

    case "registered_asc":
      // 오래된 등록순.
      return query.order("registered_at", {
        ascending: true,
        nullsFirst: false,
      }) as Q;

    case "start_date_desc":
      // 최근 개강순. start_date 는 NULL 가능 (백필 미적용 행) — NULLS LAST 로 뒤로 밀고
      // 개강일 동률 반들은 name ASC(가나다) 로 안정 정렬.
      return query
        .order("start_date", { ascending: false, nullsFirst: false })
        .order("name", { ascending: true }) as Q;

    case "start_date_asc":
      // 오래된 개강순. NULLS LAST + name ASC tiebreak (위와 동일 정책).
      return query
        .order("start_date", { ascending: true, nullsFirst: false })
        .order("name", { ascending: true }) as Q;

    case "end_date_desc":
      // 최근 종강순. end_date 는 NULL 가능 (백필 미적용 = 진행 중 표기) —
      // NULLS LAST 로 뒤로 밀고 종강일 동률 반들은 name ASC(가나다) 로 안정 정렬.
      return query
        .order("end_date", { ascending: false, nullsFirst: false })
        .order("name", { ascending: true }) as Q;

    case "end_date_asc":
      // 오래된 종강순. NULLS LAST + name ASC tiebreak (위와 동일 정책).
      return query
        .order("end_date", { ascending: true, nullsFirst: false })
        .order("name", { ascending: true }) as Q;

    case "name_asc":
      // 반명 가나다순.
      return query.order("name", { ascending: true }) as Q;

    case "name_desc":
      // 반명 가나다 역순.
      return query.order("name", { ascending: false }) as Q;

    case "capacity_desc":
      // 정원 많은 순 + 반명 ASC 보조.
      return query
        .order("capacity", { ascending: false, nullsFirst: false })
        .order("name", { ascending: true }) as Q;

    case "amount_per_session_desc":
      // 회당단가 높은 순 + 반명 ASC 보조.
      return query
        .order("amount_per_session", {
          ascending: false,
          nullsFirst: false,
        })
        .order("name", { ascending: true }) as Q;

    case "amount_per_session_asc":
      // 회당단가 낮은 순 + 반명 ASC 보조.
      return query
        .order("amount_per_session", {
          ascending: true,
          nullsFirst: false,
        })
        .order("name", { ascending: true }) as Q;

    case "total_sessions_desc":
      // 총회차 많은 순 + 반명 ASC 보조.
      return query
        .order("total_sessions", {
          ascending: false,
          nullsFirst: false,
        })
        .order("name", { ascending: true }) as Q;

    case "enrolled_count_desc":
    case "enrolled_count_asc":
      // DB 측 집계 컬럼 부재로 페이지 한정 정렬.
      // 일단 default 와 동일한 안정 정렬(최근 등록 강좌 우선)로 페이지를 fetch 한 뒤,
      // applyEnrolledCountSortInPage() 가 JS 단에서 재정렬한다.
      return query
        .order("registered_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false, nullsFirst: false }) as Q;

    default: {
      // 미래 enum 추가 시 컴파일 타임 누락 방지 (학생 리스트 패턴 미러).
      const _exhaustive: never = sort;
      void _exhaustive;
      return query
        .order("registered_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false, nullsFirst: false }) as Q;
    }
  }
}

/**
 * 페이지 결과(수강생 수 머지 후) 에 enrolled_count 정렬을 적용한다.
 *
 * ※ DB 측 집계 컬럼이 없어 페이지 한정 정렬 — 페이지네이션 전체 일관성은
 *    깨지지만 (다음 페이지의 작은 enrolled_count 가 현재 페이지보다 클 수 있음),
 *    enrolled_count 정렬은 그게 자연스러운 한계.
 *
 * 안정성: tiebreaker 로 name ASC 적용 (DB 정렬과 톤 유지).
 */
function applyEnrolledCountSortInPage(
  rows: ClassListItem[],
  sort: ClassSort,
): ClassListItem[] {
  if (sort !== "enrolled_count_desc" && sort !== "enrolled_count_asc") {
    return rows;
  }

  const asc = sort === "enrolled_count_asc";
  const cmpName = (a: ClassListItem, b: ClassListItem): number =>
    a.name.localeCompare(b.name);

  return [...rows].sort((a, b) => {
    const av = a.enrolled_student_count;
    const bv = b.enrolled_student_count;
    if (av === bv) return cmpName(a, b);
    return asc ? av - bv : bv - av;
  });
}

/**
 * 기간 필터(startDate/endDate) 가 켜진 경우 aca_tickets 에서 그 기간 안에
 * class_date(=수업 회차 예정일) 가 1건이라도 있는 distinct aca_class_id 셋을 모은다.
 *
 * 핵심:
 *  - aca_tickets.class_date >= startDate AND class_date <= endDate
 *  - 한쪽만 있으면 그쪽만 (반대편 무한대)
 *  - aca_class_id IS NOT NULL (NULL 은 매칭 불가)
 *  - 분원 좁힘이 있으면 aca_tickets.branch 에도 동일 적용 (RLS 와 별도로 명시 필터)
 *
 * 규모 가정:
 *  - 분원 1개 ticket ≈ 1만~22만행. 기간 좁히면 보통 수천~수만행으로 줄어듦.
 *  - distinct aca_class_id 는 보통 수십~수백건 — IN 절 URL 한도(약 16KB) 안에 충분.
 *  - PostgREST `.select('col', { distinct: true })` 는 미지원이라 페이지네이션 +
 *    JS Set dedup 으로 처리. 안전상한 10,000 distinct id 까지.
 */
async function fetchClassIdsInTicketDateRange(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  filters: ClassFilters,
): Promise<string[]> {
  const PAGE_SIZE = 1000;
  const MAX_PAGES = 50; // 5만 행 안전상한. distinct class_id 셋은 보통 훨씬 작음.
  const MAX_DISTINCT = 10_000;

  const classIdSet = new Set<string>();

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let q = supabase
      .from("aca_tickets")
      .select("aca_class_id")
      .not("aca_class_id", "is", null)
      .range(from, to);

    if (filters.startDate) {
      q = q.gte("class_date", filters.startDate);
    }
    if (filters.endDate) {
      q = q.lte("class_date", filters.endDate);
    }
    // 분원 좁힘은 ticket 측에도 적용 — RLS 가 분원별 가시성을 가르더라도
    // 명시 필터를 함께 둬 RLS 비활성 환경/디버그에서도 일관성을 유지.
    if (filters.branch && filters.branch !== "") {
      q = q.eq("branch", filters.branch);
    }

    const { data, error } = await q;
    if (error) {
      throw new Error(
        `기간 필터(티켓 매칭)에 실패했습니다: ${error.message}`,
      );
    }

    const rows = (data ?? []) as Array<{ aca_class_id: string | null }>;
    if (rows.length === 0) break;

    for (const row of rows) {
      if (
        typeof row.aca_class_id === "string" &&
        row.aca_class_id.length > 0
      ) {
        classIdSet.add(row.aca_class_id);
        if (classIdSet.size >= MAX_DISTINCT) {
          // 안전상한 — distinct class_id 가 1만건을 넘으면 PostgREST URL 한도
          // 위험 + 사실상 필터 의미 약화. 운영적으로 도달 어려운 경계.
          // 콘솔에 경고만 남기고 현 셋을 반환.
          // eslint-disable-next-line no-console
          console.warn(
            `[list-classes] ticket date-range distinct class_id 셋이 ${MAX_DISTINCT}건을 초과해 절단됩니다. startDate=${filters.startDate ?? "-"} endDate=${filters.endDate ?? "-"} branch=${filters.branch ?? "-"}`,
          );
          return [...classIdSet];
        }
      }
    }

    // 마지막 페이지 (rows < PAGE_SIZE) 면 조기 종료.
    if (rows.length < PAGE_SIZE) break;
  }

  return [...classIdSet];
}

/**
 * 페이지 강좌들의 강의코드를 crm_class_codes 에서 조회.
 *
 * - 입력: 페이지의 ClassRow 들. 출력: Map<class_id, lecture_code>.
 * - 코드 미부여(백필 전이거나 신규 강좌) 강좌는 Map 에 없음 → 호출부에서 null.
 * - crm_class_codes 는 ETL 과 분리된 CRM 전용 테이블(0109). class_id = crm_classes.id.
 */
async function fetchClassCodes(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  classRows: ClassRow[],
): Promise<Map<string, string>> {
  const ids = classRows.map((c) => c.id).filter((v) => v.length > 0);
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase
    .from("crm_class_codes")
    .select("class_id, lecture_code")
    .in("class_id", ids);
  if (error) {
    // 코드 열은 정보성 — 조회 실패(예: 백필 전/배포 순서)해도 목록 자체는 살린다.
    console.warn(`[classes] 강의코드 조회 폴백(빈값): ${error.message}`);
    return new Map();
  }
  const map = new Map<string, string>();
  for (const row of (data ?? []) as Array<{
    class_id: string;
    lecture_code: string;
  }>) {
    map.set(row.class_id, row.lecture_code);
  }
  return map;
}

/**
 * 강좌 1건의 수강생 수 = ACA 등록 ∪ CRM 신청 (student_id 기준 합집합).
 *
 * - 일반 강좌: signup 집합이 없어 ACA 등록 수와 동일(종전 동작 보존).
 * - 설명회   : 두 소스 합집합. 두 명단에 모두 있는 학생은 1명으로만 센다.
 */
export function countEnrolledUnion(
  c: Pick<ClassRow, "id" | "aca_class_id">,
  enrolledSetsByAcaId: Map<string, Set<string>>,
  signupSetsByClassId: Map<string, Set<string>>,
): number {
  const acaSet =
    c.aca_class_id !== null
      ? enrolledSetsByAcaId.get(c.aca_class_id)
      : undefined;
  const signupSet = signupSetsByClassId.get(c.id);
  if (!signupSet || signupSet.size === 0) {
    return acaSet ? acaSet.size : 0;
  }
  const union = new Set<string>(acaSet ?? []);
  for (const sid of signupSet) union.add(sid);
  return union.size;
}

/**
 * 페이지 강좌들의 ACA 등록 학생 집합을 한 번의 쿼리로 집계.
 *
 * - 입력: 페이지의 ClassRow 들.
 * - 출력: Map<aca_class_id, Set<student_id>>.
 * - 빈 입력이면 빈 Map 즉시 반환 (PostgREST 빈 in 절 회피).
 *
 * 규모 가정: 페이지당 강좌 ≤ 200, 강좌당 평균 enrollment ≤ 100 정도 →
 * JS distinct 집계로 충분 (≤ 20k 행, 메모리 무시 가능).
 */
async function fetchEnrolledStudentSets(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  classRows: ClassRow[],
): Promise<Map<string, Set<string>>> {
  const acaClassIds = classRows
    .map((c) => c.aca_class_id)
    .filter((v): v is string => typeof v === "string" && v.length > 0);

  if (acaClassIds.length === 0) {
    return new Map();
  }

  // aca_class_id → Set<student_id> 로 distinct 집계.
  const studentSetByAcaId = new Map<string, Set<string>>();

  // PostgREST 기본 max_rows(=1000) cap 회피 — 페이지네이션.
  // 한 페이지에 수강생 수백 명짜리 설명회가 여러 개면 enrollments 합산이
  // 1000행을 쉽게 넘어 잘리고, cap 밖으로 밀린 강좌가 0명으로 오집계된다.
  // (상세 loader 는 강좌 1개만 조회해 cap 에 안 걸리므로 숫자가 어긋났다.)
  // 안정 정렬(aca_class_id, student_id) 후 1000행씩 끝까지 fetch.
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("crm_enrollments")
      .select("aca_class_id, student_id")
      .in("aca_class_id", acaClassIds)
      .order("aca_class_id", { ascending: true })
      .order("student_id", { ascending: true })
      .range(offset, offset + PAGE - 1);

    if (error) {
      throw new Error(
        `강좌별 수강생 집계에 실패했습니다: ${error.message}`,
      );
    }

    const rows = (data ?? []) as Array<{
      aca_class_id: string | null;
      student_id: string;
    }>;
    for (const row of rows) {
      if (!row.aca_class_id) continue;
      let set = studentSetByAcaId.get(row.aca_class_id);
      if (!set) {
        set = new Set<string>();
        studentSetByAcaId.set(row.aca_class_id, set);
      }
      set.add(row.student_id);
    }

    // 마지막 페이지(1000행 미만)면 종료.
    if (rows.length < PAGE) break;
  }

  return studentSetByAcaId;
}

/**
 * 페이지 강좌들의 CRM 신청 학생 집합을 집계 (설명회 자체 신청).
 *
 * - 입력: 페이지의 ClassRow 들.
 * - 출력: Map<class_id(crm_classes.id), Set<student_id>> — status='signed' 만.
 * - 신청 페이지(crm_class_signup_pages)는 설명회에만 존재하므로, 일반 강좌는
 *   자연히 빈 집합이 된다. 반환 Map 에 없으면 신청생 0명.
 *
 * 경로: pages(class_id) → items(signup_page_id, status='signed')
 *       → invitations(student_id). 상세 KPI(class-kpi-cards) 와 동일 소스.
 */
async function fetchSignupStudentSets(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  classRows: ClassRow[],
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  const classIds = classRows.map((c) => c.id).filter((v) => v.length > 0);
  if (classIds.length === 0) return result;

  // 1) 강좌 → 신청 페이지. 신청 페이지가 있는 강좌(=설명회)만 잡힌다.
  const { data: pageData, error: pageError } = await supabase
    .from("crm_class_signup_pages")
    .select("id, class_id")
    .in("class_id", classIds);
  if (pageError) {
    throw new Error(`신청 페이지 조회에 실패했습니다: ${pageError.message}`);
  }
  const pages = (pageData ?? []) as Array<{ id: string; class_id: string }>;
  if (pages.length === 0) return result;

  const classIdByPageId = new Map<string, string>();
  for (const p of pages) classIdByPageId.set(p.id, p.class_id);
  const pageIds = pages.map((p) => p.id);

  // 2) signed 신청 아이템 → 학생. invitation embed 로 student_id 확보.
  //    신청 규모는 작지만(설명회당 수십), max_rows(1000) cap 을 넘겨 잘리지 않게
  //    enrollments 와 동일하게 페이지네이션한다.
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("crm_class_signup_items")
      .select(
        "signup_page_id, invitation:crm_class_signup_invitations!inner(student_id)",
      )
      .in("signup_page_id", pageIds)
      .eq("status", "signed")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) {
      throw new Error(`신청 명단 집계에 실패했습니다: ${error.message}`);
    }
    const rows = (data ?? []) as Array<{
      signup_page_id: string;
      invitation: { student_id: string } | null;
    }>;
    for (const row of rows) {
      const classId = classIdByPageId.get(row.signup_page_id);
      const studentId = row.invitation?.student_id;
      if (!classId || !studentId) continue;
      let set = result.get(classId);
      if (!set) {
        set = new Set<string>();
        result.set(classId, set);
      }
      set.add(studentId);
    }
    if (rows.length < PAGE) break;
  }

  return result;
}

/**
 * applyClassFilters 의 제네릭 제약용 minimal 쿼리 빌더 인터페이스.
 *
 * Supabase JS 의 PostgrestFilterBuilder 는 select 모드(head/count)에 따라
 * 결과 타입이 분기되지만, 우리가 쓰는 메서드는 .eq/.in/.or 뿐이므로 그 셋만
 * 노출해 호출부 타입을 보존한다 (any 회피).
 */
interface ClassQueryBuilder {
  eq(column: string, value: string | boolean): ClassQueryBuilder;
  in(column: string, values: readonly string[]): ClassQueryBuilder;
  or(filters: string): ClassQueryBuilder;
  lt(column: string, value: string): ClassQueryBuilder;
  lte(column: string, value: string): ClassQueryBuilder;
  ilike(column: string, pattern: string): ClassQueryBuilder;
  not(
    column: string,
    operator: string,
    value: string | null,
  ): ClassQueryBuilder;
}

/**
 * applyClassesSort 의 제네릭 제약용 minimal 정렬 빌더 인터페이스.
 * 학생 리스트의 ProfilesOrderBuilder 와 동일 톤.
 */
interface ClassesOrderBuilder {
  order(
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean },
  ): ClassesOrderBuilder;
}
