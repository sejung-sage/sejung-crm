import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getSelectedBranch } from "@/lib/auth/branch-context";
import { getSchoolOptions } from "@/lib/groups/school-options";
import { listStudentFilterOptions } from "@/lib/profile/list-filter-options";
import { listClassOptions } from "@/lib/classes/list-class-options";
import { listTemplates } from "@/lib/templates/list-templates";
import {
  findDevProfileById,
  isDevSeedMode,
} from "@/lib/profile/students-dev-seed";
import { getClassDetail } from "@/lib/classes/get-class-detail";
import { getClassSessions } from "@/lib/classes/get-class-sessions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  ClassPrefillFilterSchema,
  GroupFiltersSchema,
  isLapsedStudent,
  type ClassPrefillFilter,
  type GroupFilters,
} from "@/lib/schemas/group";
import { ComposeInline } from "@/components/compose/compose-inline";
import type { TemplateRow } from "@/types/database";

/**
 * F3 · 새 발송 작성 (/compose)
 *
 * Server Component 래퍼. 인라인 발송(필터로 대상 선택 → 바로 발송) UI 에 필요한
 * 칩 옵션(학교/학년/지역·강좌)·템플릿을 분원 기준으로 prefetch 해
 * 클라이언트 <ComposeInline> 에 넘긴다.
 *
 * 진입 prefill (구 /groups/new 에서 이식):
 *   ?student=<id>                     학생 1명 → custom 명단(그 학생)
 *   ?class=<id>                       강좌 수강생 전체 → custom 명단
 *   ?class=<id>&filter=lapsed         강좌 이탈 학생만 → custom 명단
 *   ?class=<id>&sessionDate=<date>    그 회차 수강생만 → custom 명단
 *
 * prefill 학생들을 URL 로 넘기지 않고 서버에서 학생 id 로 해석해
 * initialFilters = { ...기본, kind:'custom', includeStudentIds:[해석된 id들] } 로
 * <ComposeInline> 에 주입한다. prefill 이 없으면 기본 'filter'(조건) 로 시작.
 *
 * 권한: master / admin / manager 만 발송. viewer 는 안내 카드.
 * 분원: prefill 이 있으면 그 학생/강좌 분원, 없으면 master 는 사이드바 선택 분원,
 *       그 외 본인 분원 고정 (클라이언트에서 칩 잠금).
 */

interface Prefill {
  /** 인라인 발송 초기 분원. 학생/강좌의 분원 그대로. */
  branch: string;
  /** custom 명단으로 담을 학생 id들. */
  studentIds: string[];
}

async function fetchPrefillFromStudent(
  studentId: string,
): Promise<Prefill | null> {
  if (isDevSeedMode()) {
    const p = findDevProfileById(studentId);
    if (!p) return null;
    return { branch: p.branch, studentIds: [p.id] };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("crm_students")
    .select("id, branch")
    .eq("id", studentId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { id: string; branch: string };
  return { branch: row.branch, studentIds: [row.id] };
}

/**
 * 강좌 ID 로 진입한 케이스. 강좌 상세 로더를 재사용해 수강생 id 를 prefill.
 *  - 'all'    : 강좌 수강생 전체 (기본값).
 *  - 'lapsed' : 수강생 중 이탈 학생(status !== '재원생')만. isLapsedStudent 단일 소스.
 * 필터링 후 0명이면 null. dev-seed 모드는 getClassDetail 이 null → 강좌 prefill 미동작.
 */
async function fetchPrefillFromClass(
  classId: string,
  filter: ClassPrefillFilter,
): Promise<Prefill | null> {
  const detail = await getClassDetail(classId);
  if (!detail) return null;
  if (detail.students.length === 0) return null;

  const selected =
    filter === "lapsed"
      ? detail.students.filter((s) => isLapsedStudent(s.status))
      : detail.students;
  if (selected.length === 0) return null;

  return {
    branch: detail.class.branch,
    studentIds: selected.map((s) => s.id),
  };
}

/**
 * 강좌 + 회차(날짜)로 진입한 케이스. aca_tickets 기준 그 날 수업 듣는 학생만.
 * crm_students.id 단위라 매핑된 학생만 담는다(미매핑 학생은 발송 불가).
 */
async function fetchPrefillFromClassSession(
  classId: string,
  date: string,
): Promise<Prefill | null> {
  const detail = await getClassDetail(classId);
  if (!detail) return null;

  const { sessions } = await getClassSessions(detail.class.aca_class_id);
  const session = sessions.find((s) => s.date === date);
  if (!session) return null;

  const studentIds = session.students
    .map((s) => s.id)
    .filter((id): id is string => id !== null);
  if (studentIds.length === 0) return null;

  return { branch: detail.class.branch, studentIds };
}

async function resolvePrefill(
  raw: Record<string, string | string[] | undefined>,
): Promise<Prefill | null> {
  const studentId = typeof raw.student === "string" ? raw.student.trim() : "";
  const classId = typeof raw.class === "string" ? raw.class.trim() : "";
  const sessionDate =
    typeof raw.sessionDate === "string" ? raw.sessionDate.trim() : "";
  // 'all' | 'lapsed'. 미지정/오타는 'all' 폴백.
  const classFilter = ClassPrefillFilterSchema.parse(raw.filter);

  // 학생 prefill 우선 — 학생 단건이 강좌보다 더 specific.
  if (studentId) return fetchPrefillFromStudent(studentId);
  if (classId && sessionDate)
    return fetchPrefillFromClassSession(classId, sessionDate);
  if (classId) return fetchPrefillFromClass(classId, classFilter);
  return null;
}

export default async function ComposePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const currentUser = await getCurrentUser();
  const devMode = isDevSeedMode();

  if (!currentUser) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-[20px] font-semibold text-[color:var(--text)]">
          새 발송 작성
        </h1>
        <div
          role="alert"
          className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-muted)] p-6 text-[14px] text-[color:var(--text-muted)]"
        >
          로그인 후 이용할 수 있습니다.
        </div>
      </div>
    );
  }

  if (currentUser.role === "viewer") {
    return (
      <div className="max-w-3xl space-y-4">
        <Link
          href="/campaigns"
          className="inline-flex items-center gap-1 text-[13px] text-[color:var(--text-muted)] hover:text-[color:var(--text)]"
        >
          <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
          문자 발송 내역
        </Link>
        <h1 className="text-[20px] font-semibold text-[color:var(--text)]">
          새 발송 작성
        </h1>
        <div
          role="alert"
          className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-muted)] p-6 text-[14px] text-[color:var(--text-muted)]"
        >
          뷰어 권한으로는 문자 발송을 진행할 수 없습니다. 매니저 이상 권한이
          필요합니다.
        </div>
      </div>
    );
  }

  // 진입 prefill 해석 (학생/강좌/회차 → 학생 id 명단).
  const prefill = await resolvePrefill(await searchParams);

  // 분원 결정: prefill 이 있으면 그 분원, 없으면 master 는 사이드바 선택 분원(없으면
  // 본인), 그 외 본인 분원.
  const branch =
    prefill?.branch ??
    (currentUser.role === "master"
      ? ((await getSelectedBranch()) ?? currentUser.branch)
      : currentUser.branch);
  const canPickBranch = currentUser.role === "master";

  // 스키마 기본값 위에 prefill 만 덮는다. prefill 진입은 학생을 직접 골라 담는
  // 흐름이므로 kind='custom'(고정 명단). prefill 없으면 기본 'filter'(조건).
  const initialFilters: GroupFilters = {
    ...GroupFiltersSchema.parse({}),
    kind: prefill ? "custom" : "filter",
    includeStudentIds: prefill ? prefill.studentIds : [],
  };

  const [schoolOptions, filterOptions, classOptions, templatesResult] =
    await Promise.all([
      getSchoolOptions(branch),
      listStudentFilterOptions({ branch, includeHidden: true }),
      listClassOptions(branch),
      listTemplates({ q: "", branch: branch || undefined, page: 1 }),
    ]);

  const templates: TemplateRow[] = templatesResult.items;

  return (
    <div className="max-w-7xl space-y-6">
      <Link
        href="/campaigns"
        className="inline-flex items-center gap-1 text-[13px] text-[color:var(--text-muted)] hover:text-[color:var(--text)]"
      >
        <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
        문자 발송 내역
      </Link>

      <header>
        <h1 className="text-[20px] font-semibold text-[color:var(--text)]">
          새 발송 작성
        </h1>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          왼쪽에서 문자를 작성하고, 오른쪽에서 조건으로 대상을 골라 바로 발송하세요.
        </p>
      </header>

      {devMode && (
        <div
          role="note"
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-4 py-2.5 text-[13px] text-[color:var(--text-muted)]"
        >
          개발용 시드 데이터로 표시 중입니다. 미리보기·비용 산출은 동작하지만
          실제 발송과 테스트 발송은 차단됩니다.
        </div>
      )}

      <ComposeInline
        branch={branch}
        canPickBranch={canPickBranch}
        initialFilters={initialFilters}
        schoolOptions={schoolOptions}
        classOptions={classOptions}
        availableGrades={filterOptions.availableGrades}
        availableRegions={filterOptions.availableRegions}
        templates={templates}
        optOutNumber={process.env.SMS_OPT_OUT_NUMBER?.trim() || "080-123-4567"}
        devMode={devMode}
      />
    </div>
  );
}
