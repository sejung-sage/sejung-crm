"use client";

/**
 * 라우트 단위 에러 fallback.
 *
 * 루트 layout 안에서 렌더되므로 사이드바 등이 그대로 유지된 채 메인 영역만
 * 에러 카드로 대체된다. globals.css 가 깔리므로 디자인 토큰 사용 가능.
 *
 * 더 심각한 케이스(루트 layout 자체 깨짐)는 global-error.tsx 가 잡는다.
 */

import { AlertTriangle, RotateCw } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-[color:var(--bg-card)] rounded-2xl p-10 text-center">
        <div className="inline-flex items-center justify-center size-12 rounded-full bg-[color:var(--danger-bg)] text-[color:var(--danger)] mb-4">
          <AlertTriangle className="size-6" strokeWidth={1.75} aria-hidden />
        </div>
        <h1 className="text-[20px] font-semibold text-[color:var(--text)] mb-2">
          일시적인 오류가 발생했습니다
        </h1>
        <p className="text-[14px] text-[color:var(--text-muted)] leading-relaxed mb-6">
          잠시 후 다시 시도해 주세요. 문제가 반복되면 잠시 뒤에 다시
          접속해 주세요.
        </p>
        {error.digest && (
          <p className="text-[12px] text-[color:var(--text-dim)] mb-4 font-mono">
            오류 코드: {error.digest}
          </p>
        )}
        <button
          type="button"
          onClick={reset}
          className="
            inline-flex items-center gap-2
            h-10 px-5 rounded-lg
            bg-[color:var(--action)] text-[color:var(--action-text)]
            text-[14px] font-medium
            hover:bg-[color:var(--action-hover)]
            transition-colors
          "
        >
          <RotateCw className="size-4" strokeWidth={2} aria-hidden />
          다시 시도
        </button>
      </div>
    </div>
  );
}
