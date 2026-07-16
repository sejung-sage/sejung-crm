import { getCurrentUser } from "@/lib/auth/current-user";
import { getSelectedBranch } from "@/lib/auth/branch-context";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { listClassSignupOptions } from "@/lib/seminars/list-class-signup-options";
import { getSchoolOptions } from "@/lib/groups/school-options";
import { listStudentFilterOptions } from "@/lib/profile/list-filter-options";
import { listClassOptions } from "@/lib/classes/list-class-options";
import { SeminarComposeWizard } from "@/components/seminars/seminar-compose-wizard";
import type { Branch } from "@/config/branches";
import { DEFAULT_DIVISION, type Division } from "@/config/divisions";
import type { ClassSignupOption } from "@/types/database";

/**
 * F5 · 설명회 문자 (/seminars/compose) — 발송 위저드 단일 페이지.
 *
 * Phase 2-B-3 (2026-06-02) 정리: 옛 "설명회 목록" 탭 제거. 강좌 목록은
 * `/classes` 페이지의 상태 segment "설명회" 토글에서 본다. 본 페이지는
 * 발송 위저드 전용으로 단순화.
 *
 * 권한: master / admin 만. 그 외는 안내 카드.
 * 분원 컨텍스트: master 사이드바 선택 분원, admin/manager 본인 분원.
 *                "전체" 분원이면 차단 (학생 분원 격리 + invitation 모델 제약).
 *
 * 진입 쿼리:
 *   ?class=<uuid>     강좌 상세 "이 설명회로 발송" 에서 사전 선택 (0084).
 *   ?seminar=<uuid>   옛 진입점 호환 (graceful: 새 데이터 매핑 없으면 무시).
 *
 * 대상 선택: 일반 /compose 와 동일하게 인라인 필터 칩 + 매칭 학생 체크 목록.
 * 옛 "발송 그룹 선택" 단계는 제거됨. 필터 칩 옵션(학교/학년/지역·강좌)을 분원
 * 기준으로 prefetch 해 위저드에 내려준다.
 */
export default async function SeminarsHubPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const pick = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;
  // 0084: ?class 우선, fallback ?seminar (옛 링크 graceful).
  const initialClassId = pick(raw.class) ?? pick(raw.seminar) ?? null;

  const currentUser = await getCurrentUser();
  const devMode = isDevSeedMode();

  if (!currentUser) {
    return (
      <Shell>
        <PageHeader />
        <PermissionCard text="로그인 후 이용할 수 있습니다." />
      </Shell>
    );
  }
  if (currentUser.role !== "master" && currentUser.role !== "admin") {
    return (
      <Shell>
        <PageHeader />
        <PermissionCard text="설명회는 master / admin 만 가능합니다." />
      </Shell>
    );
  }

  // 분원 컨텍스트. master 가 "전체" 분원이면 발송 불가.
  const selectedBranch = await getSelectedBranch();
  const branchFilter: Branch | "" =
    currentUser.role === "master"
      ? ((selectedBranch as Branch | null) ?? "")
      : (currentUser.branch as Branch);

  if (!branchFilter) {
    return (
      <Shell>
        <PageHeader />
        <PermissionCard text="좌측 상단에서 발송할 분원을 먼저 선택해 주세요. 설명회 발송은 단일 분원 단위로만 진행됩니다." />
      </Shell>
    );
  }

  const [classOptions, schoolOptions, filterOptions, studentClassOptions] =
    await Promise.all([
      listClassSignupOptions({ branch: branchFilter }),
      getSchoolOptions(branchFilter),
      listStudentFilterOptions({ branch: branchFilter, includeHidden: true }),
      listClassOptions(branchFilter),
    ]);
  const classes: ClassSignupOption[] = classOptions;

  // 발신 명의 잠금: 마스터는 발송 시 명의를 직접 고를 수 있어 잠금 없음(null).
  // 비마스터는 자기 계정의 명의로 고정(미지정이면 본원). 위저드에서 셀렉트가
  // 비활성으로 표시된다. 서버가 최종 강제하므로 이 값은 UX 표시용.
  const lockedDivision: Division | null =
    currentUser.role === "master"
      ? null
      : (currentUser.sender_division ?? DEFAULT_DIVISION);

  return (
    <Shell>
      <PageHeader />

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
        classes={classes}
        branch={branchFilter}
        lockedDivision={lockedDivision}
        schoolOptions={schoolOptions}
        classOptions={studentClassOptions}
        availableGrades={filterOptions.availableGrades}
        availableRegions={filterOptions.availableRegions}
        devMode={devMode}
        optOutNumber={process.env.SMS_OPT_OUT_NUMBER ?? "080-123-4567"}
      />
    </Shell>
  );
}

// ─── 헤더 ──────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="max-w-7xl space-y-6">{children}</div>;
}

function PageHeader() {
  return (
    <header>
      <h1 className="text-[20px] font-semibold text-[color:var(--text)]">
        설명회 문자
      </h1>
      <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
        학생별 전용 신청 페이지가 자동 발급됩니다. 학부모는 카드 1회 클릭으로
        신청할 수 있습니다. 설명회 강좌 목록은{" "}
        <a className="underline" href="/classes?status=seminar">
          강좌 페이지
        </a>
        에서 확인하세요.
      </p>
    </header>
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
