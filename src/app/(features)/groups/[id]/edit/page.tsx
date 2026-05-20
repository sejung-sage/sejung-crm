import { notFound } from "next/navigation";
import { GroupBuilder } from "@/components/groups/group-builder";
import { getGroup } from "@/lib/groups/get-group";
import { countRecipients } from "@/lib/groups/count-recipients";
import { getSchoolOptions } from "@/lib/groups/school-options";
import { listStudentFilterOptions } from "@/lib/profile/list-filter-options";
import { getCurrentUser } from "@/lib/auth/current-user";

/**
 * F2-02 · 발송 그룹 수정 (/groups/[id]/edit)
 *
 * 기존 그룹 데이터로 초기값을 채우고 동일한 GroupBuilder 를 재사용.
 * Next 16 async params.
 */
export default async function EditGroupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const group = await getGroup(id);
  if (!group) notFound();

  const [initialPreview, schoolOptions, filterOptions, currentUser] =
    await Promise.all([
      countRecipients(group.filters, group.branch),
      getSchoolOptions(group.branch),
      listStudentFilterOptions({
        branch: group.branch,
        includeHidden: true,
      }),
      getCurrentUser(),
    ]);

  // 분원 칩 변경 권한: master 만 분원 이동 가능 (운영 관리). 그 외는 잠금.
  const canPickBranch = currentUser?.role === "master";

  return (
    <GroupBuilder
      mode="edit"
      groupId={group.id}
      initial={{
        name: group.name,
        branch: group.branch,
        filters: group.filters,
      }}
      schoolOptions={schoolOptions}
      initialPreview={{
        total: initialPreview.total,
        sample: initialPreview.sample,
      }}
      // 그룹 수정 폼에서 "변경 확인" 시 diff 비교 기준이 되는 기존 필터.
      // 사용자가 폼을 바꾸기 전엔 filters === oldFilters → diff 0/0 → UI 비표시.
      oldFilters={group.filters}
      canPickBranch={canPickBranch}
      canRevealPhone={canPickBranch}
      availableGrades={filterOptions.availableGrades}
      availableRegions={filterOptions.availableRegions}
    />
  );
}
