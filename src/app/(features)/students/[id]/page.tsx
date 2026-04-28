import { notFound } from "next/navigation";
import { getStudentDetail } from "@/lib/profile/get-student-detail";
import { StudentDetailView } from "@/components/students/student-detail-view";

/**
 * F1-02 · 학생 상세 페이지 (/students/[id])
 *
 * Server Component. Next 16 async params 규약: params 는 Promise.
 */
export default async function StudentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getStudentDetail(id);
  if (!detail) notFound();
  return <StudentDetailView detail={detail} />;
}
