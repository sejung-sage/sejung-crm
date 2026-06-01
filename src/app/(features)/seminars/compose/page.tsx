import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getSelectedBranch } from "@/lib/auth/branch-context";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { listSeminars } from "@/lib/seminars/list-seminars";
import { listGroups } from "@/lib/groups/list-groups";
import { SeminarComposeWizard } from "@/components/seminars/seminar-compose-wizard";
import type { SeminarListItem, GroupListItem } from "@/types/database";

/**
 * F5 · 설명회 문자 발송 (/seminars/compose) — 0082 invitation 모델.
 *
 * Server Component 래퍼. 분원 컨텍스트의 'open' 설명회 목록 + 발송 그룹 목록을
 * 미리 로드해 클라이언트 위저드(`<SeminarComposeWizard>`) 에 전달.
 *
 * 권한: master / admin 만. 그 외는 안내 카드 + /campaigns 로 유도.
 * 분원 격리: master 는 사이드바 선택 분원, admin/manager 는 본인 분원.
 *
 * 4단계:
 *   1. 설명회 선택 (다중)
 *   2. 대상 학생 그룹 선택
 *   3. 본문 작성 (LMS/SMS, 1750 바이트 한도)
 *   4. 발송 확인 + Server Action
 *
 * 진입 쿼리:
 *   ?seminar=<uuid>   설명회 상세 "이 설명회로 발송" 에서 사전 선택.
 *   ?groupId=<uuid>   그룹 상세에서 진입 시 사전 선택(향후 추가 가능).
 */
export default async function SeminarComposePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const pick = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;
  const initialSeminarId = pick(raw.seminar) ?? null;
  const initialGroupId = pick(raw.groupId) ?? null;

  const currentUser = await getCurrentUser();
  const devMode = isDevSeedMode();

  // 권한 게이트
  if (!currentUser) {
    return (
      <Shell>
        <h1 className="text-[20px] font-semibold text-[color:var(--text)]">
          설명회 문자 발송
        </h1>
        <div
          role="alert"
          className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-muted)] p-6 text-[14px] text-[color:var(--text-muted)]"
        >
          로그인 후 이용할 수 있습니다.
        </div>
      </Shell>
    );
  }

  if (currentUser.role !== "master" && currentUser.role !== "admin") {
    return (
      <Shell>
        <h1 className="text-[20px] font-semibold text-[color:var(--text)]">
          설명회 문자 발송
        </h1>
        <div
          role="alert"
          className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-muted)] p-6 text-[14px] text-[color:var(--text-muted)]"
        >
          설명회 발송은 master / admin 만 가능합니다.
        </div>
      </Shell>
    );
  }

  // 분원 컨텍스트. master 가 "전체" 분원이면 설명회·그룹 일괄 진행이 불가
  // (학생 분원 격리·발송 액션이 단일 branch 인자를 요구). 안내 카드로 막는다.
  const branchFilter =
    currentUser.role === "master"
      ? ((await getSelectedBranch()) ?? "")
      : currentUser.branch;

  if (!branchFilter) {
    return (
      <Shell>
        <h1 className="text-[20px] font-semibold text-[color:var(--text)]">
          설명회 문자 발송
        </h1>
        <div
          role="alert"
          className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-muted)] p-6 text-[14px] text-[color:var(--text-muted)]"
        >
          좌측 상단에서 발송할 분원을 먼저 선택해 주세요. 설명회 발송은 단일 분원
          단위로만 진행됩니다.
        </div>
      </Shell>
    );
  }

  // 설명회 + 그룹 병렬 로드.
  // 설명회는 status='open' 만(발송 대상). 그룹은 분원 격리만.
  const [seminarsResult, groupsResult] = await Promise.all([
    listSeminars({ branch: branchFilter, status: "open", q: "" }),
    listGroups({ q: "", branch: branchFilter, page: 1 }),
  ]);

  const seminars: SeminarListItem[] = seminarsResult.items;
  const groups: GroupListItem[] = groupsResult.items;

  return (
    <Shell>
      <Link
        href="/campaigns"
        className="inline-flex items-center gap-1 text-[13px] text-[color:var(--text-muted)] hover:text-[color:var(--text)]"
      >
        <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
        문자 발송 내역
      </Link>

      <header>
        <h1 className="text-[20px] font-semibold text-[color:var(--text)]">
          설명회 문자 발송
        </h1>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          학생별 전용 신청 페이지가 자동 발급됩니다. 학부모는 카드 1회 클릭으로
          신청할 수 있습니다.
        </p>
      </header>

      {devMode && (
        <div
          role="note"
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-4 py-2.5 text-[13px] text-[color:var(--text-muted)]"
        >
          개발용 시드 데이터로 표시 중입니다. 실제 발송과 invitation 생성은 차단됩니다.
        </div>
      )}

      <SeminarComposeWizard
        initialSeminarId={initialSeminarId}
        initialGroupId={initialGroupId}
        seminars={seminars}
        groups={groups}
        branch={branchFilter}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="max-w-5xl space-y-6">{children}</div>;
}
