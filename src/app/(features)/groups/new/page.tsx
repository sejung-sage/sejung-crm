import { GroupBuilder } from "@/components/groups/group-builder";
import { countRecipients } from "@/lib/groups/count-recipients";
import { getSchoolOptions } from "@/lib/groups/school-options";
import { getClassDetail } from "@/lib/classes/get-class-detail";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getSelectedBranch } from "@/lib/auth/branch-context";
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
 * 진입점 prefill 두 종류:
 *   ?student=<id>   학생 상세 → 그 학생 한 명만 includeStudentIds 에 prefill
 *   ?class=<id>     강좌 상세 → 그 강좌 수강생 전부 includeStudentIds 에 prefill
 *
 * 둘 다 정규화된 `Prefill` 형태로 변환 후 동일 흐름 사용.
 * 학생 prefill 과 강좌 prefill 동시 지정 시 학생을 우선 (학생 단건이 더 specific).
 */
/**
 * 신규 그룹의 default 분원을 결정.
 *  - prefill 이 있으면 그 학생/강좌의 분원 (이미 상위에서 처리됨)
 *  - master: 사이드바 선택 분원(cookie) 또는 본인 분원
 *  - non-master: 본인 분원 강제
 *  - 비로그인 fallback: '대치'
 */
async function resolveDefaultBranch(): Promise<string> {
  const user = await getCurrentUser();
  if (!user) return "대치";
  if (user.role === "master") {
    const selected = await getSelectedBranch();
    return selected ?? user.branch ?? "대치";
  }
  return user.branch;
}

interface PrefillRecipient {
  id: string;
  name: string;
  parent_phone: string | null;
  school: string | null;
  grade: Grade | null;
}

interface Prefill {
  /** 그룹 빌더 초기 분원. 학생/강좌의 분원 그대로. */
  branch: string;
  /** 그룹 이름 placeholder — "1:1" / "{강좌명} 일회성" 등. */
  groupName: string;
  /** includeStudentIds + includeStudents 동시 채우기 위한 학생 명단. */
  recipients: PrefillRecipient[];
}

async function fetchPrefillFromStudent(
  studentId: string,
): Promise<Prefill | null> {
  if (isDevSeedMode()) {
    const p = findDevProfileById(studentId);
    if (!p) return null;
    return {
      branch: p.branch,
      groupName: `${p.name} 1:1`,
      recipients: [
        {
          id: p.id,
          name: p.name,
          parent_phone: p.parent_phone,
          school: p.school,
          grade: p.grade,
        },
      ],
    };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("student_profiles")
    .select("id, name, parent_phone, school, grade, branch")
    .eq("id", studentId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as PrefillRecipient & { branch: string };
  return {
    branch: row.branch,
    groupName: `${row.name} 1:1`,
    recipients: [
      {
        id: row.id,
        name: row.name,
        parent_phone: row.parent_phone,
        school: row.school,
        grade: row.grade,
      },
    ],
  };
}

/**
 * 강좌 ID 로 진입한 케이스. 강좌 상세 로더를 그대로 재사용해서
 * 수강생 전체를 includeStudents 에 prefill.
 *
 * 주의: getClassDetail 은 dev-seed 모드에서 null 반환하므로
 * dev-seed 환경에서는 강좌 prefill 자체가 동작하지 않음 (의도적 — 강좌 시드 부재).
 */
async function fetchPrefillFromClass(classId: string): Promise<Prefill | null> {
  const detail = await getClassDetail(classId);
  if (!detail) return null;
  if (detail.students.length === 0) return null;
  return {
    branch: detail.class.branch,
    groupName: `${detail.class.name} 일회성`,
    recipients: detail.students.map((s) => ({
      id: s.id,
      name: s.name,
      parent_phone: s.parent_phone,
      school: s.school,
      grade: s.grade,
    })),
  };
}

export default async function NewGroupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const studentId =
    typeof raw.student === "string" ? raw.student.trim() : "";
  const classId = typeof raw.class === "string" ? raw.class.trim() : "";

  // 학생 prefill 우선 — 학생 단건이 강좌보다 더 specific.
  // 동시 지정은 비정상 흐름이지만 학생 우선으로 안전 처리.
  let prefill: Prefill | null = null;
  if (studentId) {
    prefill = await fetchPrefillFromStudent(studentId);
  } else if (classId) {
    prefill = await fetchPrefillFromClass(classId);
  }

  const branch = prefill?.branch ?? (await resolveDefaultBranch());
  const initialFilters: GroupFilters = {
    grades: [],
    schools: [],
    subjects: [],
    regions: [],
    statuses: [],
    includeStudentIds: prefill ? prefill.recipients.map((r) => r.id) : [],
    excludeStudentIds: [],
  };

  const [initialPreview, schoolOptions, currentUser] = await Promise.all([
    countRecipients(initialFilters, branch),
    getSchoolOptions(branch),
    getCurrentUser(),
  ]);

  // 분원 칩 변경 권한: master 만 다른 분원 그룹 생성 가능.
  const canPickBranch = currentUser?.role === "master";

  return (
    <GroupBuilder
      mode="create"
      initial={{
        name: prefill?.groupName ?? "",
        branch,
        filters: {
          ...initialFilters,
          includeStudents: prefill?.recipients ?? [],
        },
      }}
      schoolOptions={schoolOptions}
      initialPreview={{
        total: initialPreview.total,
        sample: initialPreview.sample,
      }}
      canPickBranch={canPickBranch}
      canRevealPhone={canPickBranch}
    />
  );
}
