import { notFound } from "next/navigation";
import { getStudentDetail } from "@/lib/profile/get-student-detail";
import { getCurrentUser } from "@/lib/auth/current-user";
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
  const [detail, currentUser] = await Promise.all([
    getStudentDetail(id),
    getCurrentUser(),
  ]);
  if (!detail) notFound();
  // 학생 상세 페이지 한정: master 외에 본인 분원 운영자(admin/manager/viewer)도
  // PhoneReveal 토글 가능. 학부모 응대 시 번호 확인이 일상 업무라 허용.
  // RLS 가 본인 분원 학생만 보이게 막아주므로 분원 격리는 자동.
  // 학생 명단·그룹·캠페인 등 다른 페이지의 학부모 번호는 그대로 master 만 풀 노출.
  const canRevealPhone =
    currentUser?.role === "master" ||
    (currentUser != null && currentUser.branch === detail.profile.branch);
  return <StudentDetailView detail={detail} canRevealPhone={canRevealPhone} />;
}
