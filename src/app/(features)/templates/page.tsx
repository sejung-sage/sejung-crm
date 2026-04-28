import {
  listTemplates,
  listUniqueTeachers,
} from "@/lib/templates/list-templates";
import { TemplateListQuerySchema } from "@/lib/schemas/template";
import { TemplatesToolbar } from "@/components/templates/templates-toolbar";
import { TemplatesTable } from "@/components/templates/templates-table";
import { Pagination } from "@/components/students/pagination";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";

/**
 * F3-01 · 문자 & 알림톡 템플릿 리스트 (/templates)
 *
 * Server Component. URL searchParams 기반 필터.
 * Next 16 에서 searchParams 는 Promise — 반드시 await.
 */
const PAGE_SIZE = 50;

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;

  const pick = (v: string | string[] | undefined): string | undefined => {
    if (Array.isArray(v)) return v[0];
    return v;
  };

  const parsed = TemplateListQuerySchema.parse({
    q: pick(raw.q) ?? "",
    type: pick(raw.type),
    teacher_name: pick(raw.teacher_name),
    page: pick(raw.page) ?? 1,
  });

  const [result, teachers] = await Promise.all([
    listTemplates(parsed),
    listUniqueTeachers(),
  ]);
  const devMode = isDevSeedMode();

  return (
    <div className="max-w-7xl space-y-6">
      {/* 페이지 헤더 */}
      <header>
        <h1 className="text-[20px] font-semibold text-[color:var(--text)]">
          문자 & 알림톡 템플릿
        </h1>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          자주 쓰는 문자 본문을 저장해 두고, 발송 시 바로 불러오세요.
        </p>
      </header>

      {/* 툴바 */}
      <TemplatesToolbar teachers={teachers} />

      {devMode && (
        <div
          role="note"
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-4 py-2.5 text-[13px] text-[color:var(--text-muted)]"
        >
          개발용 시드 데이터로 표시 중입니다. 저장·수정·삭제는 Supabase 연결
          후 실제 반영됩니다.
        </div>
      )}

      {/* 결과 수 */}
      <p className="text-[13px] text-[color:var(--text-muted)]">
        총{" "}
        <strong className="text-[color:var(--text)]">
          {result.total.toLocaleString()}
        </strong>
        개 템플릿
      </p>

      {/* 테이블 */}
      <TemplatesTable rows={result.items} />

      {/* 페이지네이션 */}
      <Pagination
        page={parsed.page}
        pageSize={PAGE_SIZE}
        total={result.total}
      />
    </div>
  );
}
