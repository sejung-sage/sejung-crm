import { redirect, RedirectType } from "next/navigation";

/**
 * 루트 진입점 — 학생 명단으로 즉시 리다이렉트 (운영자 default landing).
 *
 * 2026-05-20 사용자 결정 — 빈 환영 페이지 대신 가장 자주 쓰는 화면 노출.
 *
 * 2026-05-22 fix — redirect type 을 'replace' 로. default 는 'push' 이라
 * 사용자가 / 진입 → /students 로 자동 이동 시 history 에 / 가 쌓임.
 * 그 후 어디서든 뒤로가기 누르면 / 로 갔다가 또 redirect → 사용자는
 * "뒤로가기 했는데 안 움직였다" 또는 "홈으로 끌려갔다" 라고 느낌.
 */
export default function HomePage() {
  redirect("/students", RedirectType.replace);
}
