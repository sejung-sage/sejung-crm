import type { Metadata } from "next";
import { lookupSeminarByToken } from "@/lib/seminars/lookup-seminar-by-token";
import type { LookupSeminarByTokenResult } from "@/types/database";
import { ParentSignupFlow } from "@/components/seminars/parent-signup-flow";
import { formatKstDateTime } from "@/lib/datetime";
import { AlertCircle, Calendar, MapPin } from "lucide-react";

export const metadata: Metadata = {
  title: "설명회 신청 · 세정학원",
  robots: { index: false, follow: false },
};

/**
 * 학부모 공개 설명회 신청 페이지 — `/s/[token]`
 *
 * - **인증 없음**. middleware.ts 의 matcher 에서 `/s/*` 가 이미 제외돼 있음.
 * - **모바일 우선**. 단일 컬럼, 최대 480px, 터치 영역 48px+.
 * - 데이터: `lookupSeminarByToken(token)` (capacity / 신청수는 비공개).
 * - 상태 분기는 seminar.status + signup_opens_at/closes_at 으로 결정.
 *   ParentSignupFlow 내부에서 RPC 가 'closed'/'ended'/'cancelled' 를 반환하면
 *   다시 forced state 로 전환된다.
 */
type Search = Record<string, string | string[] | undefined>;

const INQUIRY_PHONE = "02-501-0000"; // 데모용 — 향후 분원별 문의번호로 교체

export default async function PublicSeminarPage({
  params,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Search>;
}) {
  const { token } = await params;

  const seminar = await lookupSeminarByToken(token);

  if (!seminar) {
    return (
      <PublicShell>
        <StatusCard
          title="유효하지 않은 링크입니다"
          message="링크가 만료되었거나 잘못 입력되었을 수 있습니다. 문자로 받은 링크 전체를 다시 눌러보시거나, 학원에 문의해 주세요."
          inquiryPhone={INQUIRY_PHONE}
        />
      </PublicShell>
    );
  }

  // 실제 상태 → 학부모용 카드 매핑.
  // 신청 창(window) 밖이면 ended 로 분류해 안내.
  const now = Date.now();
  const opensAt = seminar.signup_opens_at
    ? new Date(seminar.signup_opens_at).getTime()
    : null;
  const closesAt = seminar.signup_closes_at
    ? new Date(seminar.signup_closes_at).getTime()
    : null;

  const beforeOpens = opensAt !== null && now < opensAt;
  const afterCloses = closesAt !== null && now > closesAt;

  if (seminar.status === "closed") {
    return (
      <PublicShell>
        <SeminarHeader seminar={seminar} />
        <StatusCard
          title="정원이 마감되었습니다"
          message="이미 신청 정원이 모두 찼습니다. 추가 신청 가능 여부는 학원에 문의해 주세요."
          inquiryPhone={INQUIRY_PHONE}
        />
      </PublicShell>
    );
  }

  if (seminar.status === "ended" || afterCloses) {
    return (
      <PublicShell>
        <SeminarHeader seminar={seminar} />
        <StatusCard
          title="신청 기간이 종료되었습니다"
          message="이 설명회의 신청 기간이 끝났습니다. 다음 설명회 일정은 학원에 문의해 주세요."
          inquiryPhone={INQUIRY_PHONE}
        />
      </PublicShell>
    );
  }

  if (seminar.status === "cancelled") {
    return (
      <PublicShell>
        <SeminarHeader seminar={seminar} />
        <StatusCard
          title="설명회가 취소되었습니다"
          message="사정에 의해 이 설명회가 취소되었습니다. 자세한 사항은 학원에 문의해 주세요."
          inquiryPhone={INQUIRY_PHONE}
        />
      </PublicShell>
    );
  }

  if (beforeOpens) {
    return (
      <PublicShell>
        <SeminarHeader seminar={seminar} />
        <StatusCard
          title="신청 시작 전입니다"
          message={`신청은 ${formatKstDateTime(seminar.signup_opens_at)} 부터 가능합니다. 시간 맞춰 다시 접속해 주세요.`}
          inquiryPhone={INQUIRY_PHONE}
        />
      </PublicShell>
    );
  }

  // open → 폼
  return (
    <PublicShell>
      <SeminarHeader seminar={seminar} />

      {seminar.description && (
        <div className="rounded-xl bg-[color:var(--bg-muted)] p-4">
          <p className="text-[14px] leading-relaxed text-[color:var(--text)] whitespace-pre-line">
            {seminar.description}
          </p>
        </div>
      )}

      <hr className="border-[color:var(--border-strong)]" />

      <ParentSignupFlow
        token={token}
        seminar={seminar}
        inquiryPhone={INQUIRY_PHONE}
      />
    </PublicShell>
  );
}

// ─── 공통 셸 ─────────────────────────────────────────────

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[color:var(--bg)]">
      <div className="mx-auto w-full max-w-[480px] px-5 py-8 space-y-6">
        {/* 학원 텍스트 로고 (BI 없음) */}
        <header className="text-center">
          <p className="text-[14px] font-medium tracking-wide text-[color:var(--text-muted)]">
            세정학원
          </p>
        </header>

        {children}

        <footer className="pt-4 text-center text-[12px] text-[color:var(--text-dim)]">
          본 페이지는 설명회 신청 전용 페이지입니다.
        </footer>
      </div>
    </main>
  );
}

function SeminarHeader({
  seminar,
}: {
  seminar: LookupSeminarByTokenResult;
}) {
  return (
    <section className="space-y-3">
      <h1 className="text-[22px] font-semibold leading-snug text-[color:var(--text)]">
        {seminar.name}
      </h1>

      <div className="space-y-1.5 text-[14px]">
        {seminar.held_at && (
          <div className="flex items-start gap-2 text-[color:var(--text-muted)]">
            <Calendar
              className="mt-0.5 size-4 shrink-0 text-[color:var(--text-dim)]"
              strokeWidth={1.75}
              aria-hidden
            />
            <span className="text-[color:var(--text)]">
              {formatKstDateTime(seminar.held_at)}
            </span>
          </div>
        )}
        {seminar.venue && (
          <div className="flex items-start gap-2 text-[color:var(--text-muted)]">
            <MapPin
              className="mt-0.5 size-4 shrink-0 text-[color:var(--text-dim)]"
              strokeWidth={1.75}
              aria-hidden
            />
            <span className="text-[color:var(--text)]">{seminar.venue}</span>
          </div>
        )}
      </div>
    </section>
  );
}

function StatusCard({
  title,
  message,
  inquiryPhone,
}: {
  title: string;
  message: string;
  inquiryPhone: string;
}) {
  return (
    <section
      role="alert"
      className="rounded-2xl border border-[color:var(--border-strong)] bg-bg-card p-6 text-center space-y-4"
    >
      <div className="inline-flex items-center justify-center size-12 rounded-full bg-[color:var(--bg-muted)]">
        <AlertCircle
          className="size-7 text-[color:var(--text-muted)]"
          strokeWidth={1.75}
          aria-hidden
        />
      </div>
      <h2 className="text-[18px] font-semibold text-[color:var(--text)]">
        {title}
      </h2>
      <p className="text-[14px] leading-relaxed text-[color:var(--text-muted)]">
        {message}
      </p>
      <p className="pt-2 text-[14px] text-[color:var(--text-muted)]">
        문의:{" "}
        <a
          href={`tel:${inquiryPhone.replace(/-/g, "")}`}
          className="text-[color:var(--text)] font-medium hover:underline"
        >
          {inquiryPhone}
        </a>
      </p>
    </section>
  );
}
