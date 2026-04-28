import { GroupBuilder } from "@/components/groups/group-builder";
import { countRecipients } from "@/lib/groups/count-recipients";
import { getSchoolOptions } from "@/lib/groups/school-options";
import type { GroupFilters } from "@/lib/schemas/group";

/**
 * F2-02 · 발송 그룹 생성 (/groups/new)
 *
 * Server Component 래퍼. 초기 프리뷰·학교 후보를 서버에서 한 번 로딩 후
 * GroupBuilder 에 넘긴다. 실제 편집 상호작용은 클라이언트에서 처리.
 */
const DEFAULT_BRANCH = "대치"; // dev 기본값. Phase 1 에서 로그인 사용자 분원으로 대체.

export default async function NewGroupPage() {
  const initialFilters: GroupFilters = {
    grades: [],
    schools: [],
    subjects: [],
  };
  const [initialPreview, schoolOptions] = await Promise.all([
    countRecipients(initialFilters, DEFAULT_BRANCH),
    getSchoolOptions(),
  ]);

  return (
    <GroupBuilder
      mode="create"
      initial={{
        name: "",
        branch: DEFAULT_BRANCH,
        filters: initialFilters,
      }}
      schoolOptions={schoolOptions}
      initialPreview={{
        total: initialPreview.total,
        sample: initialPreview.sample,
      }}
    />
  );
}
