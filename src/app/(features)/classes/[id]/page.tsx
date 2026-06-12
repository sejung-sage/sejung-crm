import { notFound } from "next/navigation";
import { getClassDetail } from "@/lib/classes/get-class-detail";
import { getClassSessions } from "@/lib/classes/get-class-sessions";
import { getClassSignupPage } from "@/lib/seminars/get-class-signup-page";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/auth/can";
import { ClassDetailView } from "@/components/classes/class-detail-view";

/**
 * F0 · 강좌 상세 페이지 (/classes/[id])
 *
 * Server Component. Next 16 async params 규약: params 는 Promise.
 * loader 가 null 반환(미존재 또는 dev seed 모드) 시 notFound().
 */
export default async function ClassDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [detail, currentUser] = await Promise.all([
    getClassDetail(id),
    getCurrentUser(),
  ]);
  if (!detail) notFound();
  const canRevealPhone = currentUser?.role === "master";
  // "이 강좌로 발송" 진입 게이팅 = 그 분원에 발송 그룹을 만들 수 있는가.
  // /groups/new → createGroupAction 이 write(group) 권한(master/admin)을
  // 요구하므로 동일 기준으로 1차 노출 제어. admin 은 본인 분원만.
  // (서버 액션이 최종 방어 — UI 게이팅은 표시/숨김 용도)
  const canSendToClass = can(
    currentUser,
    "write",
    "group",
    detail.class.branch,
  );

  // 설명회 강좌면 공개 신청 페이지 데이터도 함께 로드. 그 외는 빈 detail.
  // 0084 새 모델 — class_id 1:1 page.
  // 일반 강좌면 회차(날짜)별 수강 명단(aca_tickets 기준)도 로드. 설명회는 회차 티켓이
  // 없어 빈 결과라 호출 생략.
  const isSeminar = detail.class.subject === "설명회";
  const [signupPageDetail, sessions] = await Promise.all([
    isSeminar ? getClassSignupPage(detail.class.id) : Promise.resolve(null),
    isSeminar
      ? Promise.resolve({ sessions: [], totalSessions: 0 })
      : getClassSessions(detail.class.aca_class_id),
  ]);

  return (
    <ClassDetailView
      detail={detail}
      canRevealPhone={canRevealPhone}
      canSendToClass={canSendToClass}
      signupPageDetail={signupPageDetail}
      sessions={sessions}
    />
  );
}
