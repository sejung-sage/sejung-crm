import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getSelectedBranch } from "@/lib/auth/branch-context";
import { getSchoolOptions } from "@/lib/groups/school-options";
import { listStudentFilterOptions } from "@/lib/profile/list-filter-options";
import { listClassOptions } from "@/lib/classes/list-class-options";
import { listTemplates } from "@/lib/templates/list-templates";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { ComposeInline } from "@/components/compose/compose-inline";
import type { TemplateRow } from "@/types/database";

/**
 * F3 · 새 발송 작성 (/compose)
 *
 * Server Component 래퍼. 인라인 발송(필터로 대상 선택 → 바로 발송) UI 에 필요한
 * 칩 옵션(학교/학년/지역·강좌)·템플릿을 분원 기준으로 prefetch 해
 * 클라이언트 <ComposeInline> 에 넘긴다.
 *
 * 권한: master / admin / manager 만 발송. viewer 는 안내 카드.
 * 분원: master 는 사이드바 선택 분원, 그 외 본인 분원 고정 (클라이언트에서 칩 잠금).
 */
export default async function ComposePage() {
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

  // 분원 결정: master 는 사이드바 선택 분원(없으면 본인), 그 외 본인 분원.
  const branch =
    currentUser.role === "master"
      ? ((await getSelectedBranch()) ?? currentUser.branch)
      : currentUser.branch;
  const canPickBranch = currentUser.role === "master";

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
