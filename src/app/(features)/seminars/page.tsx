import Link from "next/link";
import { Plus } from "lucide-react";
import { listSeminars } from "@/lib/seminars/list-seminars";
import { parseClassSearchParams } from "@/lib/schemas/class";
import { applyBranchContextToParams } from "@/lib/auth/branch-context";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/can";
import { BRANCHES } from "@/config/branches";
import { SeminarsToolbar } from "@/components/seminars/seminars-toolbar";
import { SeminarsTable } from "@/components/seminars/seminars-table";
import { Pagination } from "@/components/students/pagination";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";

/**
 * 설명회 전용 목록 페이지 (/seminars)
 *
 * Server Component. 강좌 리스트(/classes) 패턴을 미러하되 설명회에 맞게 슬림화.
 *  - searchParams 파싱은 강좌와 동일한 `parseClassSearchParams` 재사용
 *    (설명회 강제 status='seminar' 는 listSeminars 로더가 주입하므로 여기서 안 함)
 *  - 데이터는 `listSeminars` 한 번 호출 — 신청 페이지 상태/신청수 머지 포함
 *  - 페이지네이션은 학생/강좌 리스트 컴포넌트 재사용
 *
 * 상세는 강좌 상세(/classes/[id]) 를 공용한다 (subject='설명회' 분기로 2패널 렌더).
 */
export default async function SeminarsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await applyBranchContextToParams(await searchParams);
  const filters = parseClassSearchParams(raw);

  const [result, currentUser] = await Promise.all([
    listSeminars(filters),
    getCurrentUser(),
  ]);
  const devMode = isDevSeedMode();
  const canPickBranch = currentUser?.role === "master";
  // CRM 내부 설명회 생성 진입 — master/admin 만(설명회=강좌 write 권한).
  const canCreate =
    currentUser?.role === "master" || currentUser?.role === "admin";

  // 행별 "발송" 액션 노출 게이팅 — 강좌 리스트와 동일 기준(write/group).
  // master 는 전체(null), admin 은 본인 분원만, 그 외는 빈 배열(미노출).
  const sendableBranches: string[] | null =
    currentUser?.role === "master"
      ? null
      : BRANCHES.filter((b) => can(currentUser, "write", "group", b));

  return (
    <div className="max-w-7xl space-y-6">
      {/* 페이지 헤더 */}
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold text-[color:var(--text)]">
            설명회
          </h1>
          <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
            설명회를 모아 보고 신청 현황을 확인할 수 있습니다.
          </p>
        </div>
        {canCreate && (
          <Link
            href="/seminars/new"
            className="inline-flex shrink-0 items-center gap-1.5 h-10 px-4 rounded-lg bg-[color:var(--action)] text-[color:var(--action-text)] text-[14px] font-medium hover:bg-[color:var(--action-hover)] transition-colors"
          >
            <Plus className="size-4" strokeWidth={2} aria-hidden />
            설명회 만들기
          </Link>
        )}
      </header>

      {/* 슬림 툴바 (검색 + 분원) */}
      <SeminarsToolbar canPickBranch={canPickBranch} />

      {devMode && (
        <div
          role="note"
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-4 py-2.5 text-[13px] text-[color:var(--text-muted)]"
        >
          개발용 시드 모드입니다. 설명회 시드는 비어 있어 결과가 0건으로
          표시됩니다.
        </div>
      )}

      {/* 결과 수 */}
      <p className="text-[13px] text-[color:var(--text-muted)]">
        총{" "}
        <strong className="text-[color:var(--text)]">
          {result.total.toLocaleString()}
        </strong>
        개
      </p>

      {/* 테이블 */}
      <SeminarsTable rows={result.rows} sendableBranches={sendableBranches} />

      <Pagination
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
      />
    </div>
  );
}
