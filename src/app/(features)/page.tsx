import { redirect } from "next/navigation";

/**
 * 루트 진입점 — 학생 명단으로 즉시 리다이렉트 (운영자 default landing).
 * 2026-05-20 사용자 결정 — 빈 환영 페이지 대신 가장 자주 쓰는 화면 노출.
 */
export default function HomePage() {
  redirect("/students");
}
