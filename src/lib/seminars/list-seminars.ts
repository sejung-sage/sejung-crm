/**
 * 설명회 전용 목록 (/seminars) 데이터 로더.
 *
 * 기존 강좌 목록 로더(`@/lib/classes/list-classes`) 를 그대로 재사용해
 * subject='설명회' 강좌 목록을 얻은 뒤, 각 강좌에 부착된 신청 페이지
 * (`crm_class_signup_pages`) 와 신청 완료(signed) 수를 머지해 설명회 화면용
 * 행으로 가공한다. DB 스키마 변경 없음 — 기존 테이블만 조회.
 *
 * 쿼리 구조 (기본 1 + 1 + 1, signed 가 1000행 초과 시 (3) 만 페이지네이션):
 *   1) listClasses({ ...filters, status: "seminar" })
 *      — 설명회 강좌 목록 + total/page/pageSize. status='seminar' 필터 로직은
 *        list-classes 에 이미 있으므로 재구현하지 않고 강제 주입만 한다.
 *   2) 페이지의 class_id 들로 crm_class_signup_pages 1회 배치 조회 (IN).
 *   3) 조회된 page.id 들로 crm_class_signup_items 를 status=eq.signed 로 1회
 *      배치 조회 (IN) 후, JS 에서 page 별 카운트 집계 (학생당 row 1개 가정).
 *
 * 머지 규칙 (각 강좌 행 → SeminarListItem):
 *   - 페이지 없음 : signup_status=null, signed_count=0, held_at=null,
 *                   effective_capacity = class.capacity ?? null
 *   - 페이지 있음 : signup_status=page.status, held_at=page.held_at,
 *                   signed_count = 집계값,
 *                   effective_capacity = page.capacity_override
 *                                        ?? class.capacity ?? null
 *
 * dev-seed 모드:
 *   - list-classes 가 dev-seed 에서 빈 결과(0건) 를 주므로, 그 결과를 그대로
 *     반환한다 (페이지/items 추가 조회 불필요). get-class-signup-page 의
 *     isDevSeedMode 가드와 같은 의도.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listClasses } from "@/lib/classes/list-classes";
import type { ClassFilters } from "@/lib/schemas/class";
import type { ClassListItem } from "@/types/database";

/**
 * 설명회 목록 화면 행 타입.
 * ClassListItem(강좌 기본 + 수강생 수) 에 신청 페이지 상태 4종을 더한다.
 */
export interface SeminarListItem extends ClassListItem {
  /** 신청 페이지 상태. 페이지 미생성이면 null. */
  signup_status: "draft" | "open" | "closed" | null;
  /** CRM 신청 완료(signed) item 수. 페이지 없으면 0. */
  signed_count: number;
  /** 정원 = crm_class_signup_pages.capacity_override ?? crm_classes.capacity. 둘 다 null이면 null(무제한). */
  effective_capacity: number | null;
  /** 행사 일시(crm_class_signup_pages.held_at). 페이지 없으면 null. */
  held_at: string | null;
}

export interface ListSeminarsResult {
  /** 페이지 행 (신청 페이지 상태 머지 포함). */
  rows: SeminarListItem[];
  /** 필터 적용 후 전체 매칭 행 수 (페이지네이션용). */
  total: number;
  page: number;
  pageSize: number;
}

export async function listSeminars(
  filters: ClassFilters,
): Promise<ListSeminarsResult> {
  // (1) 설명회 강좌 목록 — status='seminar' 강제 주입. dev-seed 모드에서는
  //     list-classes 가 빈 결과를 주므로 그대로 흘려보낸다 (아래 빈 가드).
  const base = await listClasses({ ...filters, status: "seminar" });

  // 강좌가 0건이면 (dev-seed 포함) 추가 조회 없이 그대로 반환.
  if (base.rows.length === 0) {
    return {
      rows: [],
      total: base.total,
      page: base.page,
      pageSize: base.pageSize,
    };
  }

  const supabase = await createSupabaseServerClient();

  // (2) 페이지의 강좌 id 들로 신청 페이지 1회 배치 조회.
  const classIds = base.rows.map((c) => c.id);

  type SignupPageRow = {
    id: string;
    class_id: string;
    status: "draft" | "open" | "closed";
    held_at: string | null;
    capacity_override: number | null;
  };
  const { data: pageData, error: pageError } = (await supabase
    .from("crm_class_signup_pages")
    .select("id, class_id, status, held_at, capacity_override")
    .in("class_id", classIds)) as unknown as {
    data: SignupPageRow[] | null;
    error: { message: string } | null;
  };
  if (pageError) {
    throw new Error(
      `설명회 신청 페이지 조회에 실패했습니다: ${pageError.message}`,
    );
  }

  const pages = pageData ?? [];
  // class_id → 페이지 메타 (UNIQUE class_id 라 1:1).
  const pageByClassId = new Map<string, SignupPageRow>();
  for (const p of pages) {
    pageByClassId.set(p.class_id, p);
  }

  // (3) 신청 완료(signed) item 수 집계 — page.id 들로 1회 배치 조회 후 JS 카운트.
  //     학생당 row 1개 가정. 페이지가 하나도 없으면 빈 in 절을 피한다.
  const signedCountByPageId = new Map<string, number>();
  const pageIds = pages.map((p) => p.id);
  if (pageIds.length > 0) {
    type SignedItemRow = { signup_page_id: string };
    // PostgREST 기본 max_rows(=1000) cap 회피 — 페이지네이션.
    // 정원 999 설명회가 한 페이지에 둘 이상 만석이면 signed 합산이 1000행을
    // 넘어 잘리고 일부 설명회가 과소 집계된다. 1000행씩 끝까지 fetch.
    const PAGE = 1000;
    for (let offset = 0; ; offset += PAGE) {
      const { data: itemData, error: itemError } = (await supabase
        .from("crm_class_signup_items")
        .select("signup_page_id")
        .eq("status", "signed")
        .in("signup_page_id", pageIds)
        .order("signup_page_id", { ascending: true })
        .range(offset, offset + PAGE - 1)) as unknown as {
        data: SignedItemRow[] | null;
        error: { message: string } | null;
      };
      if (itemError) {
        throw new Error(
          `설명회 신청 완료 수 집계에 실패했습니다: ${itemError.message}`,
        );
      }
      const itemRows = itemData ?? [];
      for (const row of itemRows) {
        signedCountByPageId.set(
          row.signup_page_id,
          (signedCountByPageId.get(row.signup_page_id) ?? 0) + 1,
        );
      }
      if (itemRows.length < PAGE) break;
    }
  }

  // (4) 강좌 행 → SeminarListItem 머지.
  const rows: SeminarListItem[] = base.rows.map((c) => {
    const page = pageByClassId.get(c.id);
    if (!page) {
      // 페이지 미생성 — 발송 시점에 자동 생성될 예정.
      return {
        ...c,
        signup_status: null,
        signed_count: 0,
        effective_capacity: c.capacity ?? null,
        held_at: null,
      };
    }
    return {
      ...c,
      signup_status: page.status,
      signed_count: signedCountByPageId.get(page.id) ?? 0,
      effective_capacity: page.capacity_override ?? c.capacity ?? null,
      held_at: page.held_at,
    };
  });

  return {
    rows,
    total: base.total,
    page: base.page,
    pageSize: base.pageSize,
  };
}
