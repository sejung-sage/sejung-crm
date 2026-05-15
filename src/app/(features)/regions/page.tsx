import Link from "next/link";
import { ChevronRight, MapPin, ShieldAlert } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  listSchoolRegionsAction,
  listMissingSchoolRegionsAction,
} from "./actions";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { REGION_OPTIONS } from "@/config/regions";
import { RegionAddForm } from "@/components/regions/region-add-form";
import { RegionsTable } from "@/components/regions/regions-table";
import { MissingSchoolsPanel } from "@/components/regions/missing-schools-panel";

/**
 * 관리 · 학교 → 지역 매핑 (/regions)
 *
 * Server Component.
 *
 * 정책:
 *  - master / admin 만 접근. manager / viewer 는 ForbiddenCard.
 *  - URL ?q=...&region=... 으로 매핑 표 검색·필터.
 *  - 미매핑 학교 패널은 분리된 액션으로 prefetch.
 *
 * 데이터:
 *  - 매핑 표: listSchoolRegionsAction({ search, region })
 *  - 미매핑 학교: listMissingSchoolRegionsAction()
 *  - 두 호출은 병렬.
 */
export default async function RegionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const currentUser = await getCurrentUser();

  // ─── 권한 가드 ────────────────────────────────────────────
  if (
    !currentUser ||
    (currentUser.role !== "master" && currentUser.role !== "admin")
  ) {
    return <ForbiddenCard />;
  }

  const raw = await searchParams;
  const pick = (v: string | string[] | undefined): string => {
    if (Array.isArray(v)) return v[0] ?? "";
    return v ?? "";
  };
  const q = pick(raw.q).trim();
  const regionFilter = pick(raw.region).trim();

  const [mappingsResult, missingResult] = await Promise.all([
    listSchoolRegionsAction({
      search: q || undefined,
      region: regionFilter || undefined,
    }),
    listMissingSchoolRegionsAction(),
  ]);

  const rows = mappingsResult.status === "success" ? mappingsResult.data : [];
  const missing =
    missingResult.status === "success"
      ? missingResult.data
      : { items: [], total: 0, limit: 50 };

  // 매핑 표에서 이미 등장하는 region 들 + 칩 5종을 합쳐 dropdown 옵션으로.
  // 운영자가 자유 추가한 지역도 자연스럽게 노출.
  const knownRegions = collectKnownRegions(rows);

  const devMode = isDevSeedMode();

  return (
    <div className="max-w-6xl space-y-6">
      {/* 브레드크럼 */}
      <nav
        aria-label="현재 위치"
        className="flex items-center gap-1 text-[13px] text-[color:var(--text-muted)]"
      >
        <span>관리</span>
        <ChevronRight className="size-3.5" strokeWidth={1.75} aria-hidden />
        <span className="text-[color:var(--text)] font-medium">
          학교·지역 매핑
        </span>
      </nav>

      {/* 페이지 헤더 */}
      <header className="space-y-1">
        <h1 className="flex items-center gap-2 text-[20px] font-semibold text-[color:var(--text)]">
          <MapPin className="size-5" strokeWidth={1.75} aria-hidden />
          학교 → 지역 매핑
        </h1>
        <p className="text-[14px] text-[color:var(--text-muted)] leading-relaxed">
          학생 명단의 지역 필터에서 사용됩니다. 학교를 적절한 지역으로 분류해
          두면 강남구·서초구·송파구·동작구·용산구·인천 송도 별로 빠르게 학생을
          추릴 수 있습니다. 매핑되지 않은 학교의 학생은 자동으로
          &lsquo;기타&rsquo; 에 포함됩니다.
        </p>
      </header>

      {devMode && (
        <div
          role="note"
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-4 py-2.5 text-[13px] text-[color:var(--text-muted)]"
        >
          개발용 시드 데이터로 표시 중입니다. 추가·수정·삭제는 Supabase 연결 후
          실제 반영됩니다.
        </div>
      )}

      {(mappingsResult.status === "failed" ||
        missingResult.status === "failed") && (
        <div
          role="alert"
          className="rounded-lg border border-[color:var(--danger)] bg-[color:var(--danger-bg)] px-4 py-2.5 text-[14px] text-[color:var(--danger)]"
        >
          {mappingsResult.status === "failed"
            ? mappingsResult.reason
            : missingResult.status === "failed"
              ? missingResult.reason
              : ""}
        </div>
      )}

      {/* 새 학교 추가 폼 */}
      <RegionAddForm knownRegions={knownRegions} />

      {/* 검색·필터 바 */}
      <RegionsSearchBar
        q={q}
        regionFilter={regionFilter}
        knownRegions={knownRegions}
      />

      {/* 미매핑 학교 패널 */}
      <MissingSchoolsPanel
        items={missing.items}
        total={missing.total}
        limit={missing.limit}
        knownRegions={knownRegions}
      />

      {/* 전체 매핑 테이블 */}
      <RegionsTable rows={rows} knownRegions={knownRegions} />
    </div>
  );
}

// ─── 지역 옵션 수집 ────────────────────────────────────────

/**
 * dropdown 옵션 풀.
 * SSOT(src/config/regions.ts) 의 REGION_OPTIONS + 매핑 표에 실제로 등장한
 * region 들의 합집합. 한국어 정렬, 중복 제거.
 */
function collectKnownRegions(
  rows: ReadonlyArray<{ region: string }>,
): string[] {
  const set = new Set<string>(REGION_OPTIONS);
  for (const r of rows) {
    if (typeof r.region === "string" && r.region.trim().length > 0) {
      set.add(r.region.trim());
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, "ko"));
}

// ─── 검색·필터 바 (Server Component, GET form) ─────────────

function RegionsSearchBar({
  q,
  regionFilter,
  knownRegions,
}: {
  q: string;
  regionFilter: string;
  knownRegions: string[];
}) {
  return (
    <form
      method="get"
      action="/regions"
      className="flex flex-col md:flex-row md:items-end gap-3"
    >
      <label className="flex-1 min-w-0">
        <span className="block text-[13px] font-medium text-[color:var(--text-muted)] mb-1">
          학교명 검색
        </span>
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="예: 휘문고"
          className="
            w-full h-10 rounded-lg px-3
            bg-bg-card border border-[color:var(--border)]
            text-[15px] text-[color:var(--text)]
            placeholder:text-[color:var(--text-dim)]
            focus:outline-none focus:border-[color:var(--border-strong)]
            transition-colors
          "
        />
      </label>

      <label className="md:w-56">
        <span className="block text-[13px] font-medium text-[color:var(--text-muted)] mb-1">
          지역
        </span>
        <select
          name="region"
          defaultValue={regionFilter}
          className="
            w-full h-10 rounded-lg px-3
            bg-bg-card border border-[color:var(--border)]
            text-[15px] text-[color:var(--text)]
            focus:outline-none focus:border-[color:var(--border-strong)]
            cursor-pointer
          "
        >
          <option value="">전체</option>
          {knownRegions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="
            inline-flex items-center justify-center
            h-10 px-4 rounded-lg
            bg-[color:var(--action)] text-[color:var(--action-text)]
            text-[14px] font-medium
            hover:bg-[color:var(--action-hover)]
            transition-colors
          "
        >
          검색
        </button>
        {(q !== "" || regionFilter !== "") && (
          <Link
            href="/regions"
            className="
              inline-flex items-center justify-center
              h-10 px-4 rounded-lg
              border border-[color:var(--border)] bg-bg-card
              text-[14px] text-[color:var(--text-muted)]
              hover:text-[color:var(--text)] hover:bg-[color:var(--bg-hover)]
              transition-colors
            "
          >
            초기화
          </Link>
        )}
      </div>
    </form>
  );
}

// ─── 권한 없음 카드 ────────────────────────────────────────

function ForbiddenCard() {
  return (
    <div className="max-w-2xl">
      <div className="rounded-xl border border-[color:var(--border)] bg-bg-card p-8 text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-[color:var(--bg-muted)]">
          <ShieldAlert
            className="size-6 text-[color:var(--text-muted)]"
            strokeWidth={1.75}
            aria-hidden
          />
        </div>
        <h1 className="text-[18px] font-semibold text-[color:var(--text)]">
          권한이 없습니다
        </h1>
        <p className="mt-2 text-[14px] text-[color:var(--text-muted)] leading-relaxed">
          학교·지역 매핑 관리는 마스터 또는 관리자만 접근할 수 있습니다. 권한이
          필요하면 원장에게 문의해 주세요.
        </p>
      </div>
    </div>
  );
}
