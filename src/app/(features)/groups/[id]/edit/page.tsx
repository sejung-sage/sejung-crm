import { notFound } from "next/navigation";
import { GroupBuilder } from "@/components/groups/group-builder";
import { getGroup } from "@/lib/groups/get-group";
import { countRecipients } from "@/lib/groups/count-recipients";
import { getSchoolOptions } from "@/lib/groups/school-options";

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

  const [initialPreview, schoolOptions] = await Promise.all([
    countRecipients(group.filters, group.branch),
    getSchoolOptions(),
  ]);

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
    />
  );
}
