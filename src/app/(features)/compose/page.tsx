import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listGroups } from "@/lib/groups/list-groups";
import { listTemplates } from "@/lib/templates/list-templates";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { ComposeWizard } from "@/components/compose/compose-wizard";
import type { GroupListItem, TemplateRow } from "@/types/database";

/**
 * F3 Part B · 새 발송 작성 (/compose)
 *
 * Server Component 래퍼. 그룹/템플릿 목록을 미리 로드해
 * 클라이언트 위저드(`<ComposeWizard>`) 에 전달한다.
 *
 * - 권한: master / admin / manager 만. viewer 는 안내 카드.
 * - searchParams: ?groupId=... ?templateId=... 로 초기값 주입 가능
 *   (그룹 상세 / 캠페인 페이지에서 컨텍스트 넘겨받기 위함).
 *
 * 다음 단계:
 *   - Step1: 그룹 선택
 *   - Step2: 템플릿 선택 또는 직접 작성
 *   - Step3: 미리보기 · 비용 · 테스트 발송
 *   - Step4: 즉시 / 예약
 */
export default async function ComposePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const pick = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;
  const initialGroupId = pick(raw.groupId) ?? null;
  const initialTemplateId = pick(raw.templateId) ?? null;

  const currentUser = await getCurrentUser();
  const devMode = isDevSeedMode();

  // 권한 게이트
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

  // 그룹 / 템플릿 미리 로드 (드롭다운용 — 첫 페이지 50건)
  const [groupsResult, templatesResult] = await Promise.all([
    listGroups({ q: "", branch: "", page: 1 }),
    listTemplates({ q: "", page: 1 }),
  ]);

  const groups: GroupListItem[] = groupsResult.items;
  const templates: TemplateRow[] = templatesResult.items;

  return (
    <div className="max-w-6xl space-y-6">
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
          그룹 → 템플릿 → 미리보기 → 발송 순서로 진행합니다.
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

      <ComposeWizard
        initialGroupId={initialGroupId}
        initialTemplateId={initialTemplateId}
        groups={groups}
        templates={templates}
      />
    </div>
  );
}
