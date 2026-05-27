import { notFound } from "next/navigation";
import { getClassDetail } from "@/lib/classes/get-class-detail";
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
  return (
    <ClassDetailView
      detail={detail}
      canRevealPhone={canRevealPhone}
      canSendToClass={canSendToClass}
    />
  );
}
