import { AppShell } from "@/components/shell/app-shell";

/**
 * 인증 사용자용 셸 레이아웃.
 *
 * `/students`, `/groups`, `/templates`, `/campaigns`, `/accounts`, `/me`,
 * `/admin/*` 등 사이드바가 필요한 모든 페이지의 부모.
 *
 * 비인증(`/login`) 은 `app/(auth)/layout.tsx` 가 별도 풀스크린 레이아웃을 제공한다.
 */
export default function FeaturesLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <AppShell>{children}</AppShell>;
}
