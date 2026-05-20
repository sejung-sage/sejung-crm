import Link from "next/link";
import { Plus } from "lucide-react";
import { listStudents } from "@/lib/profile/list-students";
import { listStudentFilterOptions } from "@/lib/profile/list-filter-options";
import { parseStudentsSearchParams } from "@/lib/schemas/student";
import { applyBranchContextToParams } from "@/lib/auth/branch-context";
import { getCurrentUser } from "@/lib/auth/current-user";
import { StudentsTable } from "@/components/students/students-table";
import { StudentsFilters } from "@/components/students/students-filters";
import { Pagination } from "@/components/students/pagination";

/**
 * F1-01 · 학생 목록 페이지 (/students)
 *
 * Server Component. URL searchParams 기반 필터.
 * Next 16 에서 searchParams 는 Promise — 반드시 await.
 *
 * 학교 필터 옵션은 별도로 prefetch 하여 클라이언트 컴포넌트에 prop 으로
 * 내려준다. 분원 변경 시 학교 풀이 달라지므로 branch 인자에 의존.
 * (강사 필터는 노이즈 대비 효용이 낮아 학생 명단에서 제거 — 그룹 빌더에서만 사용.)
 *
 * 지역 필터(region) 는 학교 → 지역 매핑(school_regions) 으로 5종 칩 노출.
 * 매핑 관리는 /regions admin 페이지에서.
 *
 * TODO: 학생 6만 규모에서 distinct 풀 스캔이 느려지면 PG 함수
 *       `list_distinct_teachers_and_schools(branch text)` 로 이전.
 */
export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await applyBranchContextToParams(await searchParams);
  const input = parseStudentsSearchParams(raw);

  // 학생 리스트 + 학교 옵션 prefetch 를 병렬 실행.
  // 학교 옵션은 학생 명단과 동일 필터(branch/grade/level/status/includeHidden)
  // 적용 후 distinct school 만 노출 — region/schools 는 자기 자신 좁히기 방지.
  const [result, filterOptions, currentUser] = await Promise.all([
    listStudents(input),
    listStudentFilterOptions({
      branch: input.branch,
      grades: input.grades,
      schoolLevels: input.schoolLevels,
      statuses: input.statuses,
      includeHidden: input.includeHidden,
    }),
    getCurrentUser(),
  ]);
  const canPickBranch = currentUser?.role === "master";

  return (
    <div className="max-w-7xl space-y-6">
      {/* 페이지 헤더 */}
      <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-[20px] font-semibold text-[color:var(--text)]">
              학생 명단
            </h1>
            <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
              분원·학년·계열·재원 상태로 필터링하고 발송 그룹을 만들 수 있습니다.
            </p>
          </div>

          <Link
            href="/students/new"
            className="
              inline-flex items-center gap-1.5
              h-10 px-4 rounded-lg
              bg-[color:var(--action)] text-[color:var(--action-text)]
              text-[14px] font-medium
              hover:bg-[color:var(--action-hover)]
              transition-colors
            "
          >
            <Plus className="size-4" strokeWidth={2} aria-hidden />
            학생 추가하기
          </Link>
        </header>

        {/* 검색 + 필터 */}
        <StudentsFilters
          totalCount={result.total}
          source={result.source}
          schoolGroups={filterOptions.schoolGroups}
          canPickBranch={canPickBranch}
        />

        {/* 테이블 */}
        <StudentsTable rows={result.rows} canRevealPhone={canPickBranch} />

        {/* 페이지네이션 */}
      <Pagination
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </div>
  );
}
