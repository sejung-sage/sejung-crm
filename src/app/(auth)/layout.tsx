/**
 * 비인증 영역 레이아웃 (사이드바 없음).
 *
 * `/login` 등 풀스크린이 필요한 페이지가 사용한다.
 * 본문은 흰 배경의 풀화면. 페이지에서 가운데 정렬한다.
 */
export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen w-full bg-[color:var(--bg)] text-[color:var(--text)]">
      {children}
    </div>
  );
}
