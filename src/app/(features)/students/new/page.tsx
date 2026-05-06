import { StudentCreateForm } from "@/components/students/student-create-form";

/**
 * F1-03 · 학생 직접 등록 페이지 (/students/new)
 */
export default function NewStudentPage() {
  return (
    <div className="px-6 py-8">
      <StudentCreateForm />
    </div>
  );
}
