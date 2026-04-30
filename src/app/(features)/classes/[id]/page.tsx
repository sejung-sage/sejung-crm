import { notFound } from "next/navigation";
import { getClassDetail } from "@/lib/classes/get-class-detail";
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
  const detail = await getClassDetail(id);
  if (!detail) notFound();
  return <ClassDetailView detail={detail} />;
}
