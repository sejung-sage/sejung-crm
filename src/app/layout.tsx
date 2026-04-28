import type { Metadata } from "next";
import localFont from "next/font/local";
import { Cormorant_Garamond } from "next/font/google";
import "./globals.css";

// 본문 전역 폰트 · Pretendard Variable (한글 가독성 우선)
const pretendard = localFont({
  src: "../../public/fonts/PretendardVariable.woff2",
  variable: "--font-sans",
  display: "swap",
  weight: "45 920",
});

// 로고 전용 세리프 · SEJUNG Academy 로고에서만 사용
const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "세정학원 CRM",
  description: "세정학원 · 학생 명단 및 문자 발송 CRM",
};

/**
 * 루트 레이아웃은 폰트·HTML 셸만 책임진다.
 *
 * AppShell(사이드바+메인) 은 인증된 영역 전용이므로 라우트 그룹별로 적용한다:
 *   - `(features)/layout.tsx` → AppShell 적용
 *   - `(auth)/layout.tsx`     → 풀스크린(셸 없음)
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${pretendard.variable} ${cormorant.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
