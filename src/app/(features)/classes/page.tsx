import { listClasses } from "@/lib/classes/list-classes";
import { listClassFilterOptions } from "@/lib/classes/list-class-filter-options";
import { parseClassSearchParams } from "@/lib/schemas/class";
import { ClassesToolbar } from "@/components/classes/classes-toolbar";
import { ClassesTable } from "@/components/classes/classes-table";
import { Pagination } from "@/components/students/pagination";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";

/**
 * F0 · 강좌 리스트 페이지 (/classes)
 *
 * Server Component. URL searchParams 기반 필터.
 * Next 16 에서 searchParams 는 Promise — 반드시 await.
 *
 * 학생 리스트(/students), 발송 그룹(/groups) 와 동일 패턴.
 *  - searchParams 파싱은 단일 헬퍼 `parseClassSearchParams` 에 위임
 *  - 데이터 조회는 `listClasses` 한 번 호출
 *  - 페이지네이션은 학생 리스트의 컴포넌트 재사용
 */
export default async function ClassesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const filters = parseClassSearchParams(raw);

  // 강좌 리스트 + 강사 필터 옵션 prefetch 를 병렬 실행.
  // 강좌 6,000 규모라 한 번의 distinct 스캔으로 충분 (학생 리스트 패턴 미러).
  const [result, filterOptions] = await Promise.all([
    listClasses(filters),
    listClassFilterOptions(filters.branch),
  ]);
  const devMode = isDevSeedMode();

  return (
    <div className="max-w-7xl space-y-6">
      {/* 페이지 헤더 */}
      <header>
        <h1 className="text-[20px] font-semibold text-[color:var(--text)]">
          강좌
        </h1>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          분원·과목·강사명으로 강좌를 검색하고 수강생을 확인할 수 있습니다.
        </p>
      </header>

      {/* 툴바 (검색 + 필터) */}
      <ClassesToolbar teacherOptions={filterOptions.teachers} />

      {devMode && (
        <div
          role="note"
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-4 py-2.5 text-[13px] text-[color:var(--text-muted)]"
        >
          개발용 시드 모드입니다. 강좌 시드는 비어 있어 결과가 0건으로 표시됩니다.
        </div>
      )}

      {/* 결과 수 */}
      <p className="text-[13px] text-[color:var(--text-muted)]">
        총{" "}
        <strong className="text-[color:var(--text)]">
          {result.total.toLocaleString()}
        </strong>
        개 강좌
      </p>

      {/* 테이블 */}
      <ClassesTable rows={result.rows} />

      {/* 페이지네이션 — 학생 목록과 라벨 차이를 무시하고 컴포넌트 재사용
          (총 N명 → 총 N건 차이는 작은 차이라 향후 분리 가능). */}
      <Pagination
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </div>
  );
}
