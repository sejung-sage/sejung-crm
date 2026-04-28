import { listGroups } from "@/lib/groups/list-groups";
import { GroupListQuerySchema } from "@/lib/schemas/group";
import { GroupsToolbar } from "@/components/groups/groups-toolbar";
import { GroupsTable } from "@/components/groups/groups-table";
import { Pagination } from "@/components/students/pagination";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";

/**
 * F2-01 · 발송 그룹 리스트 (/groups)
 *
 * Server Component. URL searchParams 기반 필터.
 * Next 16 에서 searchParams 는 Promise — 반드시 await.
 *
 * 페이지네이션: 50건/페이지 (backend `listGroups` 가 내부적으로 동일 값 사용).
 */
const PAGE_SIZE = 50;

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;

  // searchParams 는 string | string[] | undefined 이므로 단일 값만 추출
  const pick = (v: string | string[] | undefined): string | undefined => {
    if (Array.isArray(v)) return v[0];
    return v;
  };

  const parsed = GroupListQuerySchema.parse({
    q: pick(raw.q) ?? "",
    branch: pick(raw.branch) ?? "",
    page: pick(raw.page) ?? 1,
  });

  const result = await listGroups(parsed);
  const devMode = isDevSeedMode();

  return (
    <div className="max-w-7xl space-y-6">
      {/* 페이지 헤더 */}
      <header>
        <h1 className="text-[20px] font-semibold text-[color:var(--text)]">
          발송 그룹
        </h1>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          학년·학교·과목 조건으로 수신자를 묶어 문자 발송 대상을 만듭니다.
        </p>
      </header>

      {/* 툴바 */}
      <GroupsToolbar />

      {devMode && (
        <div
          role="note"
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-4 py-2.5 text-[13px] text-[color:var(--text-muted)]"
        >
          개발용 시드 데이터로 표시 중입니다. 저장·수정·삭제는 Supabase 연결 후
          실제 반영됩니다.
        </div>
      )}

      {/* 결과 수 */}
      <p className="text-[13px] text-[color:var(--text-muted)]">
        총 <strong className="text-[color:var(--text)]">{result.total.toLocaleString()}</strong>개 그룹
      </p>

      {/* 테이블 */}
      <GroupsTable rows={result.items} />

      {/* 페이지네이션 */}
      <Pagination page={parsed.page} pageSize={PAGE_SIZE} total={result.total} />
    </div>
  );
}
