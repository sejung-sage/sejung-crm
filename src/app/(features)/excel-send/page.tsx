import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isDevSeedMode } from "@/lib/profile/students-dev-seed";
import { ExcelSendClient } from "@/components/excel-send/excel-send-client";

/**
 * 엑셀 보내기 (/excel-send)
 *
 * 그룹·설명회와 무관하게 업로드한 명단(이름·연락처 2열)으로 바로 문자를
 * 보내는 세 번째 발송 경로. 행정팀이 별도로 관리하는 엑셀 명단을 그대로
 * 가져와 한 번에 발송할 때 사용한다.
 *
 * Server Component 래퍼. 권한만 확인하고 실제 화면은 client 컴포넌트에 위임.
 *  - 권한: master / admin / manager 만. viewer 는 안내 카드.
 */
export default async function ExcelSendPage() {
  const currentUser = await getCurrentUser();
  const devMode = isDevSeedMode();

  // 권한 게이트 — /compose 와 동일.
  if (!currentUser) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-[20px] font-semibold text-[color:var(--text)]">
          엑셀 보내기
        </h1>
        <div
          role="alert"
          className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-muted)] p-6 text-[14px] text-[color:var(--text-muted)]"
        >
          로그인 후 이용할 수 있습니다.
        </div>
      </div>
    );
  }

  if (currentUser.role === "viewer") {
    return (
      <div className="max-w-3xl space-y-4">
        <Link
          href="/campaigns"
          className="inline-flex items-center gap-1 text-[13px] text-[color:var(--text-muted)] hover:text-[color:var(--text)]"
        >
          <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
          문자 발송 내역
        </Link>
        <h1 className="text-[20px] font-semibold text-[color:var(--text)]">
          엑셀 보내기
        </h1>
        <div
          role="alert"
          className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-muted)] p-6 text-[14px] text-[color:var(--text-muted)]"
        >
          뷰어 권한으로는 문자 발송을 진행할 수 없습니다. 매니저 이상 권한이
          필요합니다.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-6">
      <Link
        href="/campaigns"
        className="inline-flex items-center gap-1 text-[13px] text-[color:var(--text-muted)] hover:text-[color:var(--text)]"
      >
        <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
        문자 발송 내역
      </Link>

      <header>
        <h1 className="text-[20px] font-semibold text-[color:var(--text)]">
          엑셀 보내기
        </h1>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          이름·연락처가 담긴 엑셀 명단을 올려 한 번에 문자를 보냅니다.
        </p>
      </header>

      {devMode && (
        <div
          role="note"
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-4 py-2.5 text-[13px] text-[color:var(--text-muted)]"
        >
          개발용 시드 데이터로 표시 중입니다. 미리보기·검증은 동작하지만 실제
          발송은 차단됩니다.
        </div>
      )}

      <ExcelSendClient />
    </div>
  );
}
