import { GroupBuilder } from "@/components/groups/group-builder";
import { countRecipients } from "@/lib/groups/count-recipients";
import { getSchoolOptions } from "@/lib/groups/school-options";
import { listStudentFilterOptions } from "@/lib/profile/list-filter-options";
import { getClassDetail } from "@/lib/classes/get-class-detail";
import { getClassSessions } from "@/lib/classes/get-class-sessions";
import { listClassOptions } from "@/lib/classes/list-class-options";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getSelectedBranch } from "@/lib/auth/branch-context";
import {
  findDevProfileById,
  isDevSeedMode,
} from "@/lib/profile/students-dev-seed";
import {
  ClassPrefillFilterSchema,
  GroupFiltersSchema,
  isLapsedStudent,
  type ClassPrefillFilter,
  type GroupFilters,
} from "@/lib/schemas/group";
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
  // student_profiles 뷰는 enrollment/attendance 풀 집계라 1명 lookup 도 비용↑.
  // 표시 컬럼은 모두 students 원본이므로 crm_students 직접.
  const { data, error } = await supabase
    .from("crm_students")
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
 * 수강생을 includeStudents 에 prefill.
 *
 * filter 파라미터 ("종강 강좌 → 다음 시즌 미등록 추적", 박은주 부원장 2026-05-27):
 *  - 'all'    : 강좌 수강생 전체 (기존 동작, 기본값).
 *  - 'lapsed' : 수강생 중 이탈 학생(status !== '재원생')만.
 *               이탈 판정은 isLapsedStudent 단일 소스 사용.
 *
 * getClassDetail 이 이제 ClassStudentRow.status 를 들고 오므로 추가 쿼리 없이
 * 단일 getClassDetail 호출 결과(students)를 status 로 거른다. 강좌 1개 단위라
 * RPC/추가 쿼리 불필요.
 *
 * 필터링 후 0명이면(이탈자 없음) null 반환 — 'all' 의 0명 처리와 동일하게 안전.
 *
 * 주의: getClassDetail 은 dev-seed 모드에서 null 반환하므로
 * dev-seed 환경에서는 강좌 prefill 자체가 동작하지 않음 (의도적 — 강좌 시드 부재).
 */
/**
 * 명단 화면 체크박스 선택 결과. include 가 있으면 그 id 만, 없고 exclude 가 있으면
 * 그 id 를 뺀다. (둘 다 없으면 전원.) ClassRoster 가 URL 길이를 줄이려 더 짧은 쪽만
 * 싣는다.
 */
interface RosterFilter {
  include?: Set<string>;
  exclude?: Set<string>;
}

function applyRosterFilter(
  recipients: PrefillRecipient[],
  f: RosterFilter,
): PrefillRecipient[] {
  if (f.include) return recipients.filter((r) => f.include!.has(r.id));
  if (f.exclude) return recipients.filter((r) => !f.exclude!.has(r.id));
  return recipients;
}

async function fetchPrefillFromClass(
  classId: string,
  filter: ClassPrefillFilter,
  rosterFilter: RosterFilter,
): Promise<Prefill | null> {
  const detail = await getClassDetail(classId);
  if (!detail) return null;
  if (detail.students.length === 0) return null;

  // 'lapsed' 면 이탈 학생만 (재원생 제외). 'all' 이면 전체 유지.
  const selected =
    filter === "lapsed"
      ? detail.students.filter((s) => isLapsedStudent(s.status))
      : detail.students;

  // 필터링 후 0명(이탈자 없음)이면 기존 0명 처리와 동일하게 null.
  if (selected.length === 0) return null;

  // groupName placeholder 차별화: 'lapsed' 는 재등록 안내 톤, 'all' 은 기존 유지.
  const groupName =
    filter === "lapsed"
      ? `${detail.class.name} 미등록 재등록 안내`
      : `${detail.class.name} 일회성`;

  const recipients = applyRosterFilter(
    selected.map((s) => ({
      id: s.id,
      name: s.name,
      parent_phone: s.parent_phone,
      school: s.school,
      grade: s.grade,
    })),
    rosterFilter,
  );
  if (recipients.length === 0) return null;

  return { branch: detail.class.branch, groupName, recipients };
}

/**
 * 강좌 + 회차(날짜)로 진입한 케이스. aca_tickets 기준으로 그 날 수업 듣는 학생만
 * prefill (8회 중 7회 학생은 안 듣는 날짜에서 제외). 그룹은 crm_students.id 단위라
 * 매핑된 학생만 담는다(미매핑 학생은 연락처도 없어 발송 불가).
 */
async function fetchPrefillFromClassSession(
  classId: string,
  date: string,
  rosterFilter: RosterFilter,
): Promise<Prefill | null> {
  const detail = await getClassDetail(classId);
  if (!detail) return null;

  const { sessions } = await getClassSessions(detail.class.aca_class_id);
  const session = sessions.find((s) => s.date === date);
  if (!session) return null;

  const recipients: PrefillRecipient[] = applyRosterFilter(
    session.students
      .filter((s): s is typeof s & { id: string } => s.id !== null)
      .map((s) => ({
        id: s.id,
        name: s.name,
        parent_phone: s.parent_phone,
        school: s.school,
        grade: (s.grade as Grade | null) ?? null,
      })),
    rosterFilter,
  );
  if (recipients.length === 0) return null;

  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  return {
    branch: detail.class.branch,
    groupName: `${detail.class.name} ${m}월 ${d}일 회차`,
    recipients,
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
  // 회차(날짜) prefill — class 와 함께 오면 그 회차 수강생만 담는다.
  const sessionDate =
    typeof raw.sessionDate === "string" ? raw.sessionDate.trim() : "";
  // 강좌 prefill 의 'all' | 'lapsed'. 미지정/오타/빈 값은 catch 로 'all' 폴백.
  // student prefill 또는 prefill 없음 진입에선 무시됨 (fetchPrefillFromClass 만 사용).
  const classFilter = ClassPrefillFilterSchema.parse(raw.filter);

  // 명단 화면 체크박스 선택 → include/exclude(콤마 구분 id). include 우선.
  const parseIdSet = (
    v: string | string[] | undefined,
  ): Set<string> | undefined => {
    if (typeof v !== "string" || v.trim().length === 0) return undefined;
    const ids = v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return ids.length > 0 ? new Set(ids) : undefined;
  };
  const includeIds = parseIdSet(raw.include);
  const excludeIds = parseIdSet(raw.exclude);
  const rosterFilter: RosterFilter = {
    include: includeIds,
    exclude: includeIds ? undefined : excludeIds,
  };

  // 학생 prefill 우선 — 학생 단건이 강좌보다 더 specific.
  // 동시 지정은 비정상 흐름이지만 학생 우선으로 안전 처리.
  let prefill: Prefill | null = null;
  if (studentId) {
    prefill = await fetchPrefillFromStudent(studentId);
  } else if (classId && sessionDate) {
    prefill = await fetchPrefillFromClassSession(
      classId,
      sessionDate,
      rosterFilter,
    );
  } else if (classId) {
    prefill = await fetchPrefillFromClass(classId, classFilter, rosterFilter);
  }

  const branch = prefill?.branch ?? (await resolveDefaultBranch());
  // 스키마 기본값(.default) 위에 prefill 만 덮어쓴다. parse({}) 를 쓰면
  // 새 필터 필드(excludeSchools/excludeClassIds 등)가 추가돼도 기본값이 자동 반영.
  //
  // kind 계약 (사용자 확정 2026-05-27): student/class/lapsed prefill 진입점은
  // 학생을 직접 골라 담는 흐름이므로 결과 그룹을 **'custom'(고정 명단)** 으로
  // 강제한다. prefill 없는 일반 진입은 GroupFiltersSchema 기본값인 'filter'
  // (조건 동기화) 를 유지한다.
  const initialFilters: GroupFilters = {
    ...GroupFiltersSchema.parse({}),
    kind: prefill ? "custom" : "filter",
    includeStudentIds: prefill ? prefill.recipients.map((r) => r.id) : [],
  };

  const [
    initialPreview,
    schoolOptions,
    filterOptions,
    classOptions,
    currentUser,
  ] = await Promise.all([
    countRecipients(initialFilters, branch),
    getSchoolOptions(branch),
    // 그룹은 모든 status(탈퇴 제외) + 졸업·미정 학생도 발송 대상 가능 →
    // includeHidden=true 로 옵션 추출. statuses 는 빈 배열 = 전체 매칭.
    listStudentFilterOptions({ branch, includeHidden: true }),
    // 강좌별 제외 드롭다운 후보 (진행 중 강좌만).
    listClassOptions(branch),
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
      classOptions={classOptions}
      initialPreview={{
        total: initialPreview.total,
        sample: initialPreview.sample,
      }}
      canPickBranch={canPickBranch}
      canRevealPhone={canPickBranch}
      availableGrades={filterOptions.availableGrades}
      availableRegions={filterOptions.availableRegions}
    />
  );
}
