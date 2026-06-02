import { redirect } from "next/navigation";

/**
 * `/seminars` — 옛 진입점. Phase 2-B-3 (2026-06-02) 부터 강좌 페이지로 이전.
 *
 * 설명회는 강좌(crm_classes subject='설명회')의 부분집합이므로 목록·관리는
 * `/classes?status=seminar` 가 정식 경로. 본 라우트는 기존 북마크 보호용
 * 리다이렉트로만 유지.
 */
export default function SeminarsRedirectPage() {
  redirect("/classes?status=seminar");
}
