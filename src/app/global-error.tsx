"use client";

/**
 * 루트 레이아웃 자체가 깨졌을 때 Next.js 가 보여주는 fallback.
 *
 * 사용자 피드백: Vercel 의 검정 배경 "This page couldn't load" 화면이 너무
 * 위협적이고 디자인 톤과 안 맞음. 우리 앱 톤(흰 배경 + 검정 텍스트)으로 대체.
 *
 * 주의: global-error 는 root layout 외부에서 렌더되므로 globals.css 가 안 깔린다.
 * 토큰(var(--xxx)) 사용 불가 → 헥스 색상 직접 인라인. 디자인은 토큰 값과 동일하게
 * 맞춰서 일관성 유지.
 */

import { AlertTriangle, RotateCw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          backgroundColor: "#fafbfc",
          color: "#212529",
          fontFamily:
            "Pretendard, -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "16px",
        }}
      >
        <div
          style={{
            maxWidth: "440px",
            width: "100%",
            backgroundColor: "#ffffff",
            borderRadius: "16px",
            padding: "40px 32px",
            textAlign: "center",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "48px",
              height: "48px",
              borderRadius: "9999px",
              backgroundColor: "#fff5f5",
              color: "#c92a2a",
              marginBottom: "16px",
            }}
          >
            <AlertTriangle size={24} strokeWidth={1.75} aria-hidden />
          </div>
          <h1
            style={{
              fontSize: "20px",
              fontWeight: 600,
              color: "#212529",
              margin: "0 0 8px 0",
            }}
          >
            일시적인 오류가 발생했습니다
          </h1>
          <p
            style={{
              fontSize: "14px",
              color: "#6c757d",
              lineHeight: 1.6,
              margin: "0 0 24px 0",
            }}
          >
            잠시 후 다시 시도해 주세요. 문제가 반복되면 잠시 뒤에 다시
            접속해 주세요.
          </p>
          {error.digest && (
            <p
              style={{
                fontSize: "12px",
                color: "#adb5bd",
                marginBottom: "16px",
                fontFamily: "monospace",
              }}
            >
              오류 코드: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              height: "40px",
              padding: "0 20px",
              borderRadius: "8px",
              backgroundColor: "#212529",
              color: "#ffffff",
              fontSize: "14px",
              fontWeight: 500,
              border: "none",
              cursor: "pointer",
            }}
          >
            <RotateCw size={16} strokeWidth={2} aria-hidden />
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}
