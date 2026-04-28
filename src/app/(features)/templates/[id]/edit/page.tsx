import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getTemplate } from "@/lib/templates/get-template";
import { TemplateForm } from "@/components/templates/template-form";

/**
 * F3-01 · 템플릿 수정 (/templates/[id]/edit)
 *
 * Server Component 래퍼. DB 에서 읽어 초기값을 TemplateForm 에 전달.
 * Next 16 에서 params 는 Promise — 반드시 await.
 */
export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const template = await getTemplate(id);
  if (!template) {
    notFound();
  }

  return (
    <div className="max-w-4xl space-y-6">
      <Link
        href="/templates"
        className="inline-flex items-center gap-1 text-[13px] text-[color:var(--text-muted)] hover:text-[color:var(--text)]"
      >
        <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
        문자 & 알림톡 템플릿
      </Link>

      <header>
        <h1 className="text-[20px] font-semibold text-[color:var(--text)]">
          템플릿 수정
        </h1>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          마지막 수정: {formatDateTime(template.updated_at)}
        </p>
      </header>

      <TemplateForm
        mode="edit"
        templateId={template.id}
        initial={{
          name: template.name,
          subject: template.subject,
          body: template.body,
          type: template.type,
          teacher_name: template.teacher_name,
          is_ad: template.is_ad,
        }}
      />
    </div>
  );
}

function formatDateTime(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return iso;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}
