import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Calendar } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getSelectedBranch } from "@/lib/auth/branch-context";
import type { Branch } from "@/config/branches";
import { listMockSeminars } from "@/lib/seminars/dev-seed";
import { BranchBadge } from "@/components/groups/branch-badge";
import { SeminarStatusBadge } from "@/components/seminars/seminar-status-badge";
import { formatKstDateTime } from "@/lib/datetime";

/**
 * 설명회 리스트 (어드민) — `/seminars`
 *
 * ⚠️ UI MOCKUP ONLY. 백엔드/DB 일체 미연동.
 *
 * 권한: master / admin 만 노출. 그 외는 / 로 리다이렉트.
 * 분원 컨텍스트: master 는 사이드바 분원 선택을 따르고(전체일 때는 전체),
 *               admin 은 본인 분원 자동 고정.
 */
export default async function SeminarsPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/login");
  if (currentUser.role !== "master" && currentUser.role !== "admin") {
    redirect("/");
  }

  const selectedBranch = await getSelectedBranch();

  // master + 사이드바 "전체" 면 branch = undefined (전체 분원),
  // master + 특정 분원 선택 시 그 분원,
  // admin/manager/viewer 는 본인 분원 강제.
  const branchFilter: Branch | undefined =
    currentUser.role === "master"
      ? ((selectedBranch as Branch | null) ?? undefined)
      : (currentUser.branch as Branch);

  const rows = listMockSeminars(branchFilter);

  return (
    <div className="max-w-7xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold text-[color:var(--text)]">
            설명회
          </h1>
          <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
            학원 설명회를 만들고, 학부모에게 공개 신청 링크를 발송합니다.
          </p>
        </div>
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
      </header>

      {/* 데이터 출처 안내 */}
      <div
        role="note"
        className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-4 py-2.5 text-[13px] text-[color:var(--text-muted)]"
      >
        UI 시연용 목 데이터입니다. 정식 DB·발송·다운로드 연동은 운영자 확정 후
        진행됩니다.
      </div>

      <p className="text-[13px] text-[color:var(--text-muted)]">
        총 <strong className="text-[color:var(--text)]">{rows.length}</strong>건
        {branchFilter ? ` · ${branchFilter} 분원` : ""}
      </p>

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
                <Th className="w-28">작성자</Th>
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
                    <BranchBadge branch={r.branch} />
                  </Td>
                  <Td className="text-[14px] text-[color:var(--text-muted)] tabular-nums">
                    {formatKstDateTime(r.starts_at)}
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
                  <Td className="text-[color:var(--text-muted)]">
                    {r.created_by_name}
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
    </div>
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
