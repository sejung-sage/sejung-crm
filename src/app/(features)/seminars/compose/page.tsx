import Link from "next/link";
import { Plus, Calendar } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getSelectedBranch } from "@/lib/auth/branch-context";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { listSeminars } from "@/lib/seminars/list-seminars";
import { listClassSignupOptions } from "@/lib/seminars/list-class-signup-options";
import { listGroups } from "@/lib/groups/list-groups";
import { SeminarComposeWizard } from "@/components/seminars/seminar-compose-wizard";
import { BranchBadge } from "@/components/groups/branch-badge";
import { SeminarStatusBadge } from "@/components/seminars/seminar-status-badge";
import { formatKstDateTime } from "@/lib/datetime";
import type { Branch } from "@/config/branches";
import type {
  ClassSignupOption,
  GroupListItem,
  SeminarListItem,
} from "@/types/database";

/**
 * F5 · 설명회 문자 (/seminars/compose) — 발송 + 목록 통합 허브.
 *
 * 사이드바의 "설명회 문자" 진입점 하나로 설명회 관련 작업을 모두 처리한다
 * (2026-06-02 통합). 기존 별도 "설명회" 섹션을 제거하고 그 목록·신규 작성
 * 진입을 본 페이지의 "설명회 목록" 탭으로 합쳤다.
 *
 * 탭:
 *   ?tab=send (기본) — 설명회 문자 발송 위저드 4단계.
 *   ?tab=list        — 설명회 목록 + "새 설명회" 버튼. 상세는 /seminars/[id].
 *
 * 권한: master / admin 만 (둘 다 동일). 그 외는 안내 카드.
 * 분원 컨텍스트:
 *   - 목록 탭: master 전체 분원 보기 허용(branch="").
 *   - 발송 탭: 단일 분원 강제 (학생 분원 격리·invitation 모델 제약).
 *
 * 진입 쿼리(발송 탭):
 *   ?seminar=<uuid>   설명회 상세 "이 설명회로 발송" 에서 사전 선택.
 *   ?groupId=<uuid>   그룹 상세에서 진입 시 사전 선택(향후 추가 가능).
 */

type TabKey = "send" | "list";

function parseTab(v: string | string[] | undefined): TabKey {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "list" ? "list" : "send";
}

export default async function SeminarsHubPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const pick = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;
  const tab = parseTab(raw.tab);
  // 0084 새 모델: 진입 쿼리 ?seminar 또는 ?class 는 모두 강좌(crm_classes.id)로 해석.
  // 옛 ?seminar=<seminar UUID> 링크는 새 데이터에 매핑이 없어 step1 에서 자동 선택 안 됨 — 무해.
  const initialClassId = pick(raw.class) ?? pick(raw.seminar) ?? null;
  const initialGroupId = pick(raw.groupId) ?? null;

  const currentUser = await getCurrentUser();
  const devMode = isDevSeedMode();

  // 권한 게이트 (탭 공통)
  if (!currentUser) {
    return (
      <Shell>
        <PageHeader tab={tab} />
        <PermissionCard text="로그인 후 이용할 수 있습니다." />
      </Shell>
    );
  }
  if (currentUser.role !== "master" && currentUser.role !== "admin") {
    return (
      <Shell>
        <PageHeader tab={tab} />
        <PermissionCard text="설명회는 master / admin 만 가능합니다." />
      </Shell>
    );
  }

  // 분원 컨텍스트.
  //   master: 사이드바 선택 분원 (전체일 때는 "")
  //   admin/manager/viewer: 본인 분원 강제
  const selectedBranch = await getSelectedBranch();
  const branchFilter: Branch | "" =
    currentUser.role === "master"
      ? ((selectedBranch as Branch | null) ?? "")
      : (currentUser.branch as Branch);

  // ── 목록 탭 ─────────────────────────────────────────
  if (tab === "list") {
    const { items: rows } = await listSeminars({
      branch: branchFilter,
      status: "",
      q: "",
    });
    return (
      <Shell>
        <PageHeader tab={tab} />
        <SeminarTabs tab={tab} />
        <SeminarListSection rows={rows} branchFilter={branchFilter} />
      </Shell>
    );
  }

  // ── 발송 탭 ─────────────────────────────────────────
  // 발송은 단일 분원 단위만. master 가 "전체" 분원이면 차단.
  if (!branchFilter) {
    return (
      <Shell>
        <PageHeader tab={tab} />
        <SeminarTabs tab={tab} />
        <PermissionCard text="좌측 상단에서 발송할 분원을 먼저 선택해 주세요. 설명회 발송은 단일 분원 단위로만 진행됩니다." />
      </Shell>
    );
  }

  // 설명회 강좌 옵션 + 그룹 병렬 로드.
  // 옛 listSeminars (crm_seminars 기반) 는 더 이상 위저드가 사용 X — Phase 1-B 에서 정리.
  const [classOptions, groupsResult] = await Promise.all([
    listClassSignupOptions({ branch: branchFilter }),
    listGroups({ q: "", branch: branchFilter, page: 1 }),
  ]);
  const classes: ClassSignupOption[] = classOptions;
  const groups: GroupListItem[] = groupsResult.items;

  return (
    <Shell>
      <PageHeader tab={tab} />
      <SeminarTabs tab={tab} />

      {devMode && (
        <div
          role="note"
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-4 py-2.5 text-[13px] text-[color:var(--text-muted)]"
        >
          개발용 시드 데이터로 표시 중입니다. 실제 발송과 invitation 생성은
          차단됩니다.
        </div>
      )}

      <SeminarComposeWizard
        initialClassId={initialClassId}
        initialGroupId={initialGroupId}
        classes={classes}
        groups={groups}
        branch={branchFilter}
        optOutNumber={process.env.SMS_OPT_OUT_NUMBER ?? "080-123-4567"}
      />
    </Shell>
  );
}

// ─── 셸/헤더/탭 ────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="max-w-5xl space-y-6">{children}</div>;
}

function PageHeader({ tab }: { tab: TabKey }) {
  return (
    <header>
      <h1 className="text-[20px] font-semibold text-[color:var(--text)]">
        설명회 문자
      </h1>
      <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
        {tab === "list"
          ? "학원 설명회를 만들고 관리합니다. 신청자 명단도 여기서 확인할 수 있습니다."
          : "학생별 전용 신청 페이지가 자동 발급됩니다. 학부모는 카드 1회 클릭으로 신청할 수 있습니다."}
      </p>
    </header>
  );
}

function SeminarTabs({ tab }: { tab: TabKey }) {
  return (
    <nav
      role="tablist"
      aria-label="설명회 문자 보기 전환"
      className="border-b border-[color:var(--border)] flex gap-1"
    >
      <TabLink
        href="/seminars/compose"
        current={tab === "send"}
        label="설명회 발송"
      />
      <TabLink
        href="/seminars/compose?tab=list"
        current={tab === "list"}
        label="설명회 목록"
      />
    </nav>
  );
}

function TabLink({
  href,
  current,
  label,
}: {
  href: string;
  current: boolean;
  label: string;
}) {
  // 한 줄짜리 server tab — 클릭 시 페이지 자체 navigate. 클라이언트 상태 없음.
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={current}
      className={
        current
          ? "px-4 h-11 inline-flex items-center text-[15px] font-semibold text-[color:var(--text)] border-b-2 border-[color:var(--text)] -mb-px"
          : "px-4 h-11 inline-flex items-center text-[15px] text-[color:var(--text-muted)] hover:text-[color:var(--text)] border-b-2 border-transparent -mb-px"
      }
    >
      {label}
    </Link>
  );
}

function PermissionCard({ text }: { text: string }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-muted)] p-6 text-[14px] text-[color:var(--text-muted)]"
    >
      {text}
    </div>
  );
}

// ─── 목록 탭 본문 ──────────────────────────────────────

function SeminarListSection({
  rows,
  branchFilter,
}: {
  rows: SeminarListItem[];
  branchFilter: Branch | "";
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <p className="text-[13px] text-[color:var(--text-muted)]">
          총 <strong className="text-[color:var(--text)]">{rows.length}</strong>
          건{branchFilter ? ` · ${branchFilter} 분원` : ""}
        </p>
        <Link
          href="/seminars/new"
          className="
            inline-flex items-center justify-center gap-1.5
            h-10 px-4 rounded-lg
            bg-[color:var(--action)] text-[color:var(--action-text)]
            text-[14px] font-medium
            hover:bg-[color:var(--action-hover)]
            transition-colors shrink-0
          "
        >
          <Plus className="size-4" strokeWidth={2} aria-hidden />새 설명회
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-[color:var(--border)] bg-bg-card py-16 text-center">
          <Calendar
            className="mx-auto size-8 text-[color:var(--text-dim)]"
            strokeWidth={1.5}
            aria-hidden
          />
          <p className="mt-3 text-[15px] text-[color:var(--text-muted)]">
            아직 만든 설명회가 없습니다.
          </p>
          <p className="mt-2 text-[13px] text-[color:var(--text-dim)]">
            우측 상단 &lsquo;새 설명회&rsquo; 로 첫 설명회를 만들어 보세요.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[color:var(--border)] bg-bg-card overflow-hidden">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[color:var(--border)] bg-[color:var(--bg-muted)]">
                <Th>이름</Th>
                <Th className="w-20">분원</Th>
                <Th className="w-40">일시</Th>
                <Th className="w-20 text-right">정원</Th>
                <Th className="w-24 text-right">신청</Th>
                <Th className="w-24">상태</Th>
                <Th className="w-32">작성일</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-[color:var(--border)] last:border-b-0 hover:bg-[color:var(--bg-hover)] transition-colors"
                >
                  <Td>
                    <Link
                      href={`/seminars/${r.id}`}
                      className="font-medium text-[color:var(--text)] hover:underline"
                    >
                      {r.name}
                    </Link>
                    {r.venue && (
                      <div className="mt-0.5 text-[12px] text-[color:var(--text-muted)] line-clamp-1">
                        {r.venue}
                      </div>
                    )}
                  </Td>
                  <Td>
                    <BranchBadge branch={r.branch as Branch} />
                  </Td>
                  <Td className="text-[14px] text-[color:var(--text-muted)] tabular-nums">
                    {formatKstDateTime(r.held_at)}
                  </Td>
                  <Td className="text-right tabular-nums text-[color:var(--text-muted)]">
                    {r.capacity ? `${r.capacity}명` : "무제한"}
                  </Td>
                  <Td className="text-right tabular-nums font-medium text-[color:var(--text)]">
                    {r.signup_count}건
                  </Td>
                  <Td>
                    <SeminarStatusBadge status={r.status} />
                  </Td>
                  <Td className="text-[color:var(--text-muted)] tabular-nums text-[13px]">
                    {formatKstDateTime(r.created_at)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`
        px-4 py-3 text-left text-[13px] font-medium
        text-[color:var(--text-muted)] uppercase tracking-wide
        ${className}
      `}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-3 text-[15px] ${className}`}>{children}</td>;
}
