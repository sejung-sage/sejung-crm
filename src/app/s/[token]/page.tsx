import type { Metadata } from "next";
import { AlertCircle } from "lucide-react";
// 0082 invitation 흐름:
// 토큰은 학생 단위(`crm_seminar_invitations.link_token`). RPC `lookup_invitation_by_token`
// 가 학생 메타 + 설명회 카드 N개를 한 번에 반환한다. 호출 어댑터는 backend-dev 가
// 추가하는 중 — `src/lib/seminars/lookup-invitation-by-token.ts`.
import { lookupInvitationByToken } from "@/lib/seminars/lookup-invitation-by-token";
import { ParentInvitationFlow } from "@/components/seminars/parent-invitation-flow";

export const metadata: Metadata = {
  title: "설명회 신청 · 세정학원",
  robots: { index: false, follow: false },
};

/**
 * 학부모 공개 설명회 신청 페이지 — `/s/[token]` (0082 재설계).
 *
 * - **인증 없음**. middleware.ts 의 matcher 에서 `/s/*` 가 제외돼 있음.
 * - **모바일 우선**. 단일 컬럼, 최대 480px, 터치 영역 48px+.
 * - 데이터: `lookupInvitationByToken(token)` — 학생 메타 + items 배열.
 * - 폼 입력 없음. 학생명·전화는 RPC 가 미리 박아 보내준다.
 * - 카드 클릭 → `claimInvitationItemAction` 으로 individual seminar 신청.
 *
 * 이전 0080 폼 모델은 폐기. `lookupSeminarByToken` / `ParentSignupFlow` 미사용.
 */
const INQUIRY_PHONE = "02-501-0000"; // 데모용 — 향후 분원별 문의번호로 교체

export default async function PublicInvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const invitation = await lookupInvitationByToken(token);

  if (!invitation) {
    return (
      <PublicShell branch={null}>
        <StatusCard
          title="유효하지 않은 링크입니다"
          message="링크가 만료되었거나 잘못 입력되었을 수 있습니다. 문자로 받은 링크 전체를 다시 눌러보시거나, 학원에 문의해 주세요."
          inquiryPhone={INQUIRY_PHONE}
        />
      </PublicShell>
    );
  }

  return (
    <PublicShell branch={invitation.branch}>
      <ParentInvitationFlow
        token={token}
        invitation={invitation}
        inquiryPhone={INQUIRY_PHONE}
      />
    </PublicShell>
  );
}

// ─── 공통 셸 ─────────────────────────────────────────────

function PublicShell({
  children,
  branch,
}: {
  children: React.ReactNode;
  branch: string | null;
}) {
  return (
    <main className="min-h-screen bg-[color:var(--bg)]">
      <div className="mx-auto w-full max-w-[480px] px-5 py-8 space-y-6">
        {/* 학원 텍스트 헤더 (BI 없음) */}
        <header className="text-center">
          <p className="text-[14px] font-medium tracking-wide text-[color:var(--text-muted)]">
            세정학원{branch ? ` · ${branch}` : ""}
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
