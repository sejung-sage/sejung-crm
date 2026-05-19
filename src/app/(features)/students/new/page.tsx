import { StudentCreateForm } from "@/components/students/student-create-form";
import { getAllSchoolOptions } from "@/lib/profile/get-all-school-options";

/**
 * F1-03 · 학생 직접 등록 페이지 (/students/new)
 *
 * 학교 자동완성용 옵션을 서버에서 prefetch 해 폼에 전달.
 * 학교 풀 = students.school distinct ∪ school_regions.school (60초 캐시).
 */
export default async function NewStudentPage() {
  const schoolOptions = await getAllSchoolOptions();

  return (
    <div className="px-6 py-8">
      <StudentCreateForm schoolOptions={schoolOptions} />
    </div>
  );
}
