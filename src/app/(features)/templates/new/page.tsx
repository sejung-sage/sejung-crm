import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { TemplateForm } from "@/components/templates/template-form";

/**
 * F3-01 · 새 템플릿 (/templates/new)
 *
 * Server Component 래퍼. 초기값만 내려주고 실제 편집은 클라이언트 폼.
 *
 * 0059 마이그 이후: ALIMTALK / 강사명 제거. 기본 유형은 LMS (SMS 는 90바이트라
 * 입력 도중 제한 걸리는 일이 많아 LMS 가 행정 운영의 안전 기본값).
 */
export default function NewTemplatePage() {
  return (
    <div className="max-w-6xl space-y-6">
      <Link
        href="/templates"
        className="inline-flex items-center gap-1 text-[13px] text-[color:var(--text-muted)] hover:text-[color:var(--text)]"
      >
        <ChevronLeft className="size-4" strokeWidth={1.75} aria-hidden />
        문자 템플릿
      </Link>

      <header>
        <h1 className="text-[20px] font-semibold text-[color:var(--text)]">
          새 템플릿
        </h1>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          자주 쓰는 문자 본문을 저장해 두면 발송 시 바로 불러올 수 있습니다.
        </p>
      </header>

      <TemplateForm
        mode="create"
        initial={{
          name: "",
          subject: null,
          body: "",
          type: "LMS",
          is_ad: false,
        }}
      />
    </div>
  );
}
