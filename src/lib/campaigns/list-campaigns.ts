/**
 * F3-A · 캠페인 목록 조회
 *
 * - dev-seed: listDevCampaigns (템플릿/그룹 조인 + 도달·실패 집계 내장)
 * - Supabase: campaigns + templates + groups left join + messages 집계
 *
 * NOTE (frontend-dev): backend 가 Supabase 분기를 덮어쓸 수 있음. 시그니처
 * (`listCampaigns`, `ListCampaignsResult`) 유지.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { CampaignListItem } from "@/types/database";
import type { CampaignListQuery } from "@/lib/schemas/campaign";
import {
  isDevSeedMode,
  listDevCampaigns,
} from "@/lib/profile/students-dev-seed";

const PAGE_SIZE = 50;

export interface ListCampaignsResult {
  items: CampaignListItem[];
  total: number;
}

export async function listCampaigns(
  query: CampaignListQuery,
): Promise<ListCampaignsResult> {
  if (isDevSeedMode()) {
    return listFromDevSeed(query);
  }
  return listFromSupabase(query);
}

function listFromDevSeed(query: CampaignListQuery): ListCampaignsResult {
  const all = listDevCampaigns({
    q: query.q,
    teacher: query.teacher,
    klass: query.klass,
    status: query.status,
    from: query.from,
    to: query.to,
  });
  // sent_at/scheduled_at/created_at DESC NULLS LAST
  const sorted = [...all].sort((a, b) => {
    const aKey = a.sent_at ?? a.scheduled_at ?? a.created_at;
    const bKey = b.sent_at ?? b.scheduled_at ?? b.created_at;
    return bKey.localeCompare(aKey);
  });

  const total = sorted.length;
  const from = (query.page - 1) * PAGE_SIZE;
  // dev-seed 는 사용자 매핑이 없으므로 creator_name = null.
  const items: CampaignListItem[] = sorted
    .slice(from, from + PAGE_SIZE)
    .map((c) => ({ ...c, creator_name: null }));
  return { items, total };
}

/**
 * PostgREST or()/ilike() 사용자 입력 sanitize.
 * - or() 안의 콤마/괄호 는 항 분리자 → 제거.
 * - %, _ 는 ilike 와일드카드 → 의도치 않은 매칭 방지 위해 공백 치환.
 * 결과가 빈 문자열이면 호출부가 필터 자체를 스킵.
 */
function sanitizeIlike(v: string): string {
  return v.replace(/[%_,()]/g, " ").trim();
}

async function listFromSupabase(
  query: CampaignListQuery,
): Promise<ListCampaignsResult> {
  const supabase = await createSupabaseServerClient();
  const from = (query.page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // 발송내역 가시성 1차 가드(앱): master 는 전체, 그 외는 본인 발송분만.
  // RLS(0075)가 2차로 동일 규칙을 강제하므로 더블 가드 — 앱 단에서 미리 좁혀
  // 불필요한 row 스캔/노출을 막는다. 비-master 는 query.sender 를 무시하고
  // 본인 id 로 강제 고정. (master 만 발송자 필터를 쓸 수 있다.)
  const viewer = await getCurrentUser();
  const restrictOwnerId =
    viewer && viewer.role !== "master" ? viewer.user_id : null;

  // count 와 body 분리 병렬. select(*, count:exact) 는 body+count 가 같은 쿼리에
  // 묶여 풀 스캔 비용 증가. head:exact 만 별도 호출하면 인덱스 only-scan.
  // PostgREST 는 from() 직후엔 filter 가 없고 select() 이후 chain 만 가능.
  const applyFilters = <
    Q extends {
      eq(col: string, val: string): Q;
      ilike(col: string, val: string): Q;
      gte(col: string, val: string): Q;
      lte(col: string, val: string): Q;
      or(filter: string): Q;
    },
  >(
    q: Q,
  ): Q => {
    let next = q;
    if (query.status) next = next.eq("status", query.status);
    // q: 제목 OR 본문 ilike. PostgREST or() 안의 콤마/괄호/% 는 항 분리자라
    // 사용자 입력에 섞이면 syntax error → sanitize 한 뒤 사용.
    if (query.q) {
      const safe = sanitizeIlike(query.q);
      if (safe) {
        next = next.or(`title.ilike.%${safe}%,body.ilike.%${safe}%`);
      }
    }
    // 강사명 / 강좌명 검색은 본문 ilike. 운영팀이 "○○선생", "○○반" 으로 발송이력 추적.
    if (query.teacher) {
      const safe = sanitizeIlike(query.teacher);
      if (safe) next = next.ilike("body", `%${safe}%`);
    }
    if (query.klass) {
      const safe = sanitizeIlike(query.klass);
      if (safe) next = next.ilike("body", `%${safe}%`);
    }
    if (query.from) next = next.gte("sent_at", `${query.from}T00:00:00+09:00`);
    if (query.to) next = next.lte("sent_at", `${query.to}T23:59:59+09:00`);
    // 비-master 는 본인 id 로 강제, master 는 발송자 필터(query.sender) 적용.
    const effectiveSender = restrictOwnerId ?? (query.sender || null);
    if (effectiveSender) next = next.eq("created_by", effectiveSender);
    return next;
  };

  const countQuery = applyFilters(
    supabase
      .from("crm_campaigns")
      .select("id", { count: "exact", head: true }),
  );
  const dataQuery = applyFilters(supabase.from("crm_campaigns").select("*"))
    .order("created_at", { ascending: false })
    .range(from, to);

  const [countResult, dataResult] = await Promise.all([countQuery, dataQuery]);

  if (dataResult.error) {
    throw new Error(
      `캠페인 목록 조회에 실패했습니다: ${dataResult.error.message}`,
    );
  }

  // 작성자 이름 매핑 — list-groups 와 동일 패턴.
  // crm_users_profile 별도 lookup (auth schema 는 PostgREST 외부라 nested join 불가).
  const rawRows = (dataResult.data ?? []) as Array<Record<string, unknown>>;
  const creatorIds = Array.from(
    new Set(
      rawRows
        .map((r) => r.created_by)
        .filter((v): v is string => typeof v === "string" && v.length > 0),
    ),
  );
  const nameMap = new Map<string, string>();
  if (creatorIds.length > 0) {
    const { data: profiles, error: profileError } = await supabase
      .from("crm_users_profile")
      .select("user_id, name")
      .in("user_id", creatorIds);
    if (profileError) {
      console.warn(
        `[list-campaigns] 작성자 이름 조회 실패: ${profileError.message}`,
      );
    } else {
      for (const p of (profiles ?? []) as Array<{
        user_id: string;
        name: string;
      }>) {
        nameMap.set(p.user_id, p.name);
      }
    }
  }

  // 조인·집계는 backend 가 완성 시 덮어씀. 우선 최소 형태로 변환.
  const items: CampaignListItem[] = rawRows.map((row) => {
    const createdBy = (row.created_by ?? null) as string | null;
    return {
      id: row.id as string,
      title: row.title as string,
      template_id: (row.template_id ?? null) as string | null,
      group_id: (row.group_id ?? null) as string | null,
      scheduled_at: (row.scheduled_at ?? null) as string | null,
      sent_at: (row.sent_at ?? null) as string | null,
      status: row.status as CampaignListItem["status"],
      total_recipients: (row.total_recipients ?? 0) as number,
      total_cost: (row.total_cost ?? 0) as number,
      created_by: createdBy,
      branch: row.branch as string,
      is_test: (row.is_test ?? false) as boolean,
      body: (row.body ?? null) as string | null,
      subject: (row.subject ?? null) as string | null,
      type: (row.type ?? null) as CampaignListItem["type"],
      is_ad: (row.is_ad ?? false) as boolean,
      dedupe_by_phone: (row.dedupe_by_phone ?? false) as boolean,
      // 0077 발송 대상. DEFAULT(parent=true, student=false)로 기존 행도 채워짐.
      send_to_parent: (row.send_to_parent ?? true) as boolean,
      send_to_student: (row.send_to_student ?? false) as boolean,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string,
      template_name: null,
      group_name: null,
      delivered_count: 0,
      failed_count: 0,
      creator_name: createdBy ? (nameMap.get(createdBy) ?? null) : null,
    };
  });

  return {
    items,
    total: countResult.error ? 0 : (countResult.count ?? 0),
  };
}
