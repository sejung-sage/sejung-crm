import { notFound } from "next/navigation";
import { getGroup } from "@/lib/groups/get-group";
import { listGroupStudents } from "@/lib/groups/list-group-students";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/can";
import { GroupDetailView } from "@/components/groups/group-detail-view";

/**
 * F2-03 · 발송 그룹 상세 (/groups/[id])
 *
 * Server Component. Next 16 async params 규약: params / searchParams 는 Promise.
 * 학생 페이지네이션은 ?page= 기반 (기본 50건).
 */
const PAGE_SIZE = 50;

export default async function GroupDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const raw = await searchParams;
  const pageRaw = Array.isArray(raw.page) ? raw.page[0] : raw.page;
  const page = Math.max(1, Number(pageRaw) || 1);

  const group = await getGroup(id);
  if (!group) notFound();

  const [studentsResult, currentUser] = await Promise.all([
    listGroupStudents(id, { page }),
    getCurrentUser(),
  ]);
  const canRevealPhone = currentUser?.role === "master";
  // 그룹 편집(=학생 건별 제외) 권한: master 또는 본인 분원 admin.
  // can() 가 master 는 branch 무시, admin/manager/viewer 는 본인 분원 일치 검사를 수행.
  const canEdit = can(currentUser, "write", "group", group.branch);

  return (
    <GroupDetailView
      group={group}
      students={studentsResult.items}
      studentsTotal={studentsResult.total}
      currentPage={page}
      pageSize={PAGE_SIZE}
      canRevealPhone={canRevealPhone}
      canEdit={canEdit}
    />
  );
}
