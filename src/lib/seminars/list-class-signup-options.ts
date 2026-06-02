/**
 * 설명회 발송 위저드 1단계 옵션 로더 — 0084 새 모델 기반.
 *
 * 데이터 source: `crm_classes WHERE subject='설명회'` (0058·0083 으로 분류된 강좌)
 * + LEFT JOIN `crm_class_signup_pages` (페이지 없으면 옵션 자체는 그대로 노출하고
 * 발송 시점에 자동 생성됨).
 *
 * dev-seed: 강좌 시드 부재 — 빈 배열 graceful fallback. 위저드 1단계가 비어있는
 * 안내를 노출하면 됨.
 *
 * 호출부:
 *   /seminars/compose 의 server component (page.tsx). 위저드 client 가 받음.
 *
 * 권한:
 *   호출부(page) 가 master/admin 게이트. 본 함수는 RLS 만 신뢰.
 *   분원 격리는 SQL eq('branch', X) 강제 + RLS 2차 방어.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import type { ClassSignupOption } from "@/types/database";

interface ListClassSignupOptionsQuery {
  /** 분원 short name. 비어있으면 결과 없음 (단일 분원 전제). */
  branch: string;
}

/** 위저드 step1 옵션 평탄화 결과. */
export async function listClassSignupOptions(
  query: ListClassSignupOptionsQuery,
): Promise<ClassSignupOption[]> {
  if (isDevSeedMode()) {
    // 강좌 시드 부재 — 위저드는 빈 옵션 안내를 보여주면 됨.
    return [];
  }
  if (!query.branch) {
    return [];
  }
  return listFromSupabase(query);
}

// ─── Supabase 어댑터 ──────────────────────────────────────────

async function listFromSupabase(
  query: ListClassSignupOptionsQuery,
): Promise<ClassSignupOption[]> {
  const supabase = await createSupabaseServerClient();

  // 1) 분원의 설명회 강좌 (active=true 만 — 비활성 강좌는 발송 대상에서 제외).
  type ClassRow = {
    id: string;
    name: string;
    branch: string;
    classroom: string | null;
    capacity: number | null;
  };
  const { data: classData, error: classError } = (await supabase
    .from("crm_classes")
    .select("id, name, branch, classroom, capacity")
    .eq("subject", "설명회")
    .eq("branch", query.branch)
    .eq("active", true)
    .order("name", { ascending: true })) as unknown as {
    data: ClassRow[] | null;
    error: { message: string } | null;
  };
  if (classError) {
    throw new Error(`설명회 강좌 조회에 실패했습니다: ${classError.message}`);
  }
  const classes = classData ?? [];
  if (classes.length === 0) {
    return [];
  }

  // 2) 그 강좌들의 signup_page (있는 것만). class_id UNIQUE 라 1:1.
  type PageRow = {
    id: string;
    class_id: string;
    status: "draft" | "open" | "closed";
    held_at: string | null;
    capacity_override: number | null;
  };
  const classIds = classes.map((c) => c.id);
  const { data: pageData, error: pageError } = (await supabase
    .from("crm_class_signup_pages")
    .select("id, class_id, status, held_at, capacity_override")
    .in("class_id", classIds)) as unknown as {
    data: PageRow[] | null;
    error: { message: string } | null;
  };
  if (pageError) {
    throw new Error(
      `설명회 신청 페이지 조회에 실패했습니다: ${pageError.message}`,
    );
  }
  const pageByClass = new Map<string, PageRow>();
  for (const p of pageData ?? []) {
    pageByClass.set(p.class_id, p);
  }

  // 3) 그 페이지들의 signed 카운트. items 의 status='signed' 단순 SELECT 후 in-memory.
  //    PostgREST 의 group-by 가 제한적이라 listSeminars 와 동일 패턴.
  const pageIds = (pageData ?? []).map((p) => p.id);
  const signedByPage = new Map<string, number>();
  if (pageIds.length > 0) {
    const { data: itemRows, error: itemError } = (await supabase
      .from("crm_class_signup_items")
      .select("signup_page_id")
      .eq("status", "signed")
      .in("signup_page_id", pageIds)) as unknown as {
      data: Array<{ signup_page_id: string }> | null;
      error: { message: string } | null;
    };
    if (itemError) {
      // 카운트 실패는 치명 X — 0 으로 표시되도록 폴백.
      console.warn(
        `[list-class-signup-options] 신청수 집계 실패: ${itemError.message}`,
      );
    } else {
      for (const r of itemRows ?? []) {
        signedByPage.set(
          r.signup_page_id,
          (signedByPage.get(r.signup_page_id) ?? 0) + 1,
        );
      }
    }
  }

  // 4) 평탄화. held_at NULLS LAST 정렬은 step1 UI 에서 다시 안정정렬해도 OK.
  const items: ClassSignupOption[] = classes.map((c) => {
    const page = pageByClass.get(c.id) ?? null;
    const capacity =
      page?.capacity_override ?? c.capacity ?? null;
    return {
      class_id: c.id,
      class_name: c.name,
      branch: c.branch,
      signup_page_id: page?.id ?? null,
      signup_page_status: page?.status ?? null,
      held_at: page?.held_at ?? null,
      venue: c.classroom,
      signup_count: page ? signedByPage.get(page.id) ?? 0 : 0,
      capacity,
    };
  });

  // held_at NULLS LAST 안정정렬 (이름 기준 1차 정렬은 SQL 에서 끝).
  items.sort((a, b) => {
    if (a.held_at && b.held_at) return a.held_at.localeCompare(b.held_at);
    if (a.held_at) return -1;
    if (b.held_at) return 1;
    return 0;
  });

  return items;
}
