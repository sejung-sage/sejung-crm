import { GroupBuilder } from "@/components/groups/group-builder";
import { countRecipients } from "@/lib/groups/count-recipients";
import { getSchoolOptions } from "@/lib/groups/school-options";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  findDevProfileById,
  isDevSeedMode,
} from "@/lib/profile/students-dev-seed";
import type { GroupFilters } from "@/lib/schemas/group";
import type { Grade } from "@/types/database";

/**
 * F2-02 · 발송 그룹 생성 (/groups/new)
 *
 * Server Component 래퍼. 초기 프리뷰·학교 후보를 서버에서 한 번 로딩 후
 * GroupBuilder 에 넘긴다. 실제 편집 상호작용은 클라이언트에서 처리.
 *
 * `?student=<id>` 쿼리가 오면 그 학생을 includeStudentIds 에 prefill.
 * 학생 상세의 "이 학생에게 문자 보내기" 진입점에서 사용.
 */
const DEFAULT_BRANCH = "대치"; // dev 기본값. Phase 1 에서 로그인 사용자 분원으로 대체.

interface PrefillStudent {
  id: string;
  name: string;
  parent_phone: string | null;
  school: string | null;
  grade: Grade | null;
  branch: string;
}

async function fetchPrefillStudent(
  studentId: string,
): Promise<PrefillStudent | null> {
  if (isDevSeedMode()) {
    const p = findDevProfileById(studentId);
    if (!p) return null;
    return {
      id: p.id,
      name: p.name,
      parent_phone: p.parent_phone,
      school: p.school,
      grade: p.grade,
      branch: p.branch,
    };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("student_profiles")
    .select("id, name, parent_phone, school, grade, branch")
    .eq("id", studentId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as PrefillStudent;
  return row;
}

export default async function NewGroupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const studentId =
    typeof raw.student === "string" ? raw.student.trim() : "";

  // 학생 prefill 시도 (있으면 분원·includeStudentIds 자동 채움)
  const prefill = studentId ? await fetchPrefillStudent(studentId) : null;

  const branch = prefill?.branch ?? DEFAULT_BRANCH;
  const initialFilters: GroupFilters = {
    grades: [],
    schools: [],
    subjects: [],
    includeStudentIds: prefill ? [prefill.id] : [],
  };

  const [initialPreview, schoolOptions] = await Promise.all([
    countRecipients(initialFilters, branch),
    getSchoolOptions(),
  ]);

  return (
    <GroupBuilder
      mode="create"
      initial={{
        name: prefill ? `${prefill.name} 1:1` : "",
        branch,
        filters: {
          ...initialFilters,
          includeStudents: prefill
            ? [
                {
                  id: prefill.id,
                  name: prefill.name,
                  parent_phone: prefill.parent_phone,
                  school: prefill.school,
                  grade: prefill.grade,
                },
              ]
            : [],
        },
      }}
      schoolOptions={schoolOptions}
      initialPreview={{
        total: initialPreview.total,
        sample: initialPreview.sample,
      }}
    />
  );
}
