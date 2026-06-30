import { ShieldAlert } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { EXPLORER_DATASETS } from "@/lib/explorer/datasets";
import { listStudentFilterOptions } from "@/lib/profile/list-filter-options";
import { ExplorerClient } from "@/components/explorer/explorer-client";

/**
 * 데이터 탐색기 (/explorer) — 읽기 전용 학생/aca_* raw 조회 대시보드.
 *
 * CRM 과 분리된 내부 도구. master 전용(서버 액션도 동일 가드).
 * 비주얼 필터 빌더로 화이트리스트 데이터셋을 자유롭게 필터·정렬·내보내기.
 */
export default async function ExplorerPage() {
  const devSeed = isDevSeedMode();
  const user = devSeed ? null : await getCurrentUser();
  const isMaster = devSeed || user?.role === "master";

  if (!isMaster) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-xl border border-[color:var(--border)] bg-bg-card p-8 text-center">
        <ShieldAlert
          className="mx-auto size-8 text-[color:var(--text-dim)]"
          strokeWidth={1.5}
          aria-hidden
        />
        <h1 className="mt-3 text-[17px] font-semibold text-[color:var(--text)]">
          접근 권한이 없습니다
        </h1>
        <p className="mt-1.5 text-[14px] text-[color:var(--text-muted)]">
          데이터 탐색기는 master 계정만 사용할 수 있습니다.
        </p>
      </div>
    );
  }

  // 학교 선택 패널의 초기 옵션(전체 분원) prefetch — CRM /students 와 동일.
  const filterOptions = await listStudentFilterOptions({});

  return (
    <ExplorerClient
      datasets={EXPLORER_DATASETS}
      initialSchoolGroups={filterOptions.schoolGroups}
    />
  );
}
