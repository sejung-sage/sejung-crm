import { redirect } from "next/navigation";

/**
 * `/seminars` — 설명회 목록 진입점.
 *
 * 2026-06-02 통합: 사이드바 "설명회" 섹션을 제거하고 설명회 목록·신규·상세를
 * 모두 "문자 발송 > 설명회 문자(/seminars/compose)"의 탭으로 합쳤다. 본 라우트
 * 자체는 기존 북마크와 내부 링크(/seminars/new, /seminars/[id] 의 뒤로 가기)
 * 보호용으로 유지하며, 진입 시 통합 페이지의 "설명회 목록" 탭으로 리다이렉트.
 */
export default function SeminarsRedirectPage() {
  redirect("/seminars/compose?tab=list");
}
