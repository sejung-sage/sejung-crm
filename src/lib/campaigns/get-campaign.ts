/**
 * F3-A · 단일 캠페인 조회 (상세 페이지 헤더용)
 *
 * - dev-seed: findDevCampaignById → listDevCampaigns 경로로 조인 정보 재구성
 * - Supabase: campaigns + templates + groups 조인 + messages 집계
 *
 * NOTE (frontend-dev): backend 가 덮어쓸 수 있음.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import type { CampaignListItem } from "@/types/database";
import {
  findDevCampaignById,
  isDevSeedMode,
  listDevCampaigns,
} from "@/lib/profile/students-dev-seed";

export async function getCampaign(
  id: string,
): Promise<CampaignListItem | null> {
  if (!id) return null;

  if (isDevSeedMode()) {
    const base = findDevCampaignById(id);
    if (!base) return null;
    // listDevCampaigns 는 검색 파라미터 없이 돌리면 전체 + 조인·집계 포함.
    // 필요한 1건만 찾아서 반환.
    const joined = listDevCampaigns({}).find((c) => c.id === id);
    return joined ?? null;
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("crm_campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`캠페인 조회에 실패했습니다: ${error.message}`);
  }
  if (!data) return null;

  const row = data as Record<string, unknown>;
  const createdBy = (row.created_by ?? null) as string | null;

  // 발송내역 가시성 1차 가드(앱): master 는 전체, 그 외는 본인 발송분만.
  // RLS(0075)가 2차로 막지만, 명시적 가드로 비-소유자 직딥 접근 시 not-found 처리.
  const viewer = await getCurrentUser();
  if (viewer && viewer.role !== "master" && createdBy !== viewer.user_id) {
    return null;
  }

  const templateId = (row.template_id ?? null) as string | null;
  const groupId = (row.group_id ?? null) as string | null;

  // 작성자·템플릿·그룹 이름 병렬 lookup. RLS 차단 시 null 로 graceful fallback.
  const [creatorRes, templateRes, groupRes] = await Promise.all([
    createdBy
      ? supabase
          .from("crm_users_profile")
          .select("name")
          .eq("user_id", createdBy)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    templateId
      ? supabase
          .from("crm_templates")
          .select("name")
          .eq("id", templateId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    groupId
      ? supabase
          .from("crm_groups")
          .select("name")
          .eq("id", groupId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const creatorName =
    (creatorRes.data as { name?: string } | null)?.name ?? null;
  const templateName =
    (templateRes.data as { name?: string } | null)?.name ?? null;
  const groupName =
    (groupRes.data as { name?: string } | null)?.name ?? null;

  return {
    id: row.id as string,
    title: row.title as string,
    template_id: templateId,
    group_id: groupId,
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
    template_name: templateName,
    group_name: groupName,
    delivered_count: 0,
    failed_count: 0,
    creator_name: creatorName,
  };
}
