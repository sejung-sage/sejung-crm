import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft, Send, Calendar, MapPin, Users } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getSeminar } from "@/lib/seminars/get-seminar";
import { listSignups } from "@/lib/seminars/list-signups";
import { BranchBadge } from "@/components/groups/branch-badge";
import { SeminarStatusBadge } from "@/components/seminars/seminar-status-badge";
import { CopyLinkButton } from "@/components/seminars/copy-link-button";
import { PublicLinkInput } from "@/components/seminars/public-link-input";
import { SignupsTable } from "@/components/seminars/signups-table";
import { SeminarDetailActions } from "@/components/seminars/seminar-detail-actions";
import { formatKstDateTime } from "@/lib/datetime";
import type { Branch } from "@/config/branches";

/**
 * 설명회 상세 + 신청 명단 (어드민) — `/seminars/[id]`
 *
 * 권한: master / admin.
 * - 학부모 전화 평문 노출은 master 만.
 * - admin 도 본인 분원이 아니면 접근 불가(RLS 가 1차 차단; 여기서도 확인).
 */
export default async function SeminarDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/login");
  if (currentUser.role !== "master" && currentUser.role !== "admin") {
    redirect("/");
  }

  const seminar = await getSeminar(id);
  if (!seminar) notFound();

  // admin 은 본인 분원만.
  if (
    currentUser.role === "admin" &&
    currentUser.branch !== seminar.branch
  ) {
    redirect("/seminars");
  }

  const signups = await listSignups(seminar.id);
  const activeCount = signups.filter((s) => s.status === "signed").length;
  const publicPath = `/s/${seminar.link_token}`;
  const canRevealPhone = currentUser.role === "master";

  return (
    <div className="max-w-7xl space-y-6">
      {/* 브레드크럼 */}
      <Link
        href="/seminars"
        className="inline-flex items-center gap-1 text-[13px] text-[color:var(--text-muted)] hover:text-[color:var(--text)]"
      >
        <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
        설명회
      </Link>

      {/* 상단 카드 */}
      <section
        className="rounded-xl border border-[color:var(--border)] bg-bg-card p-6"
        aria-label="설명회 요약"
      >
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[24px] font-semibold leading-tight text-[color:var(--text)]">
                {seminar.name}
              </h1>
              <BranchBadge branch={seminar.branch as Branch} />
              <SeminarStatusBadge status={seminar.status} />
            </div>

            <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-1 text-[14px]">
              <MetaItem icon={Calendar} label="일시">
                {formatKstDateTime(seminar.held_at)}
              </MetaItem>
              {seminar.venue && (
                <MetaItem icon={MapPin} label="장소">
                  {seminar.venue}
                </MetaItem>
              )}
              <MetaItem icon={Users} label="정원">
                {seminar.capacity ? `${seminar.capacity}명` : "무제한"}
              </MetaItem>
            </dl>

            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 pt-2">
              <div>
                <span className="text-[13px] text-[color:var(--text-muted)] mr-2">
                  신청
                </span>
                <span className="text-[24px] font-semibold tabular-nums text-[color:var(--text)]">
                  {activeCount}
                </span>
                <span className="text-[14px] text-[color:var(--text-muted)] ml-1">
                  / {seminar.capacity ? `${seminar.capacity}명` : "무제한"}
                </span>
              </div>
              <div className="text-[13px] text-[color:var(--text-muted)]">
                <span className="mr-2">신청 마감</span>
                <span className="tabular-nums text-[color:var(--text)]">
                  {formatKstDateTime(seminar.signup_closes_at)}
                </span>
              </div>
              <div className="text-[13px] text-[color:var(--text-muted)]">
                <span className="mr-2">생성일</span>
                <span className="tabular-nums text-[color:var(--text)]">
                  {formatKstDateTime(seminar.created_at)}
                </span>
              </div>
            </div>
          </div>

          {/* 상단 우측 — 주요 액션 묶음 */}
          <div className="shrink-0 flex flex-col gap-2 items-stretch min-w-[200px]">
            <CopyLinkButton path={publicPath} variant="primary" label="발송 링크 복사" />
            <Link
              href={`/compose?seminarId=${seminar.id}`}
              className="
                inline-flex items-center justify-center gap-1.5
                h-10 px-4 rounded-lg
                border border-[color:var(--border-strong)] bg-bg-card
                text-[14px] text-[color:var(--text)]
                hover:bg-[color:var(--bg-hover)]
                transition-colors
              "
            >
              <Send className="size-4" strokeWidth={1.75} aria-hidden />이 설명회로 발송
            </Link>
          </div>
        </div>

        {/* 안내문 + 보조 액션 */}
        {seminar.description && (
          <div className="mt-5 rounded-lg bg-[color:var(--bg-muted)] p-4">
            <div className="text-[12px] font-medium uppercase tracking-wider text-[color:var(--text-dim)] mb-2">
              학부모 안내문
            </div>
            <p className="text-[14px] text-[color:var(--text)] whitespace-pre-line leading-relaxed">
              {seminar.description}
            </p>
          </div>
        )}

        <div className="mt-5 pt-5 border-t border-[color:var(--border-strong)] flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="flex-1 max-w-2xl">
            <div className="text-[12px] font-medium uppercase tracking-wider text-[color:var(--text-dim)] mb-2">
              공개 신청 링크
            </div>
            <PublicLinkInput path={publicPath} />
            <p className="mt-2 text-[12px] text-[color:var(--text-muted)]">
              이 링크는 별도 로그인 없이 학부모가 접속할 수 있습니다.
              문자/카톡으로 보내주세요.
            </p>
          </div>
          <SeminarDetailActions seminarId={seminar.id} status={seminar.status} />
        </div>
      </section>

      {/* 신청 명단 */}
      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
            신청 명단
          </h2>
          <p className="text-[12px] text-[color:var(--text-dim)]">
            신청 시각 최신순. 취소된 신청은 회색으로 표시됩니다.
          </p>
        </div>
        <SignupsTable
          seminarId={seminar.id}
          signups={signups}
          canRevealPhone={canRevealPhone}
        />
      </section>
    </div>
  );
}

function MetaItem({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number; "aria-hidden"?: boolean }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[color:var(--text-muted)]">
      <Icon
        className="size-4 text-[color:var(--text-dim)]"
        strokeWidth={1.75}
        aria-hidden
      />
      <span className="sr-only">{label}: </span>
      <span className="text-[color:var(--text)]">{children}</span>
    </div>
  );
}
