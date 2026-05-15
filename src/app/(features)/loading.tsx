import { Loader2 } from "lucide-react";

/**
 * (features) 라우트 그룹 공통 로딩 fallback.
 *
 * Next.js App Router 가 자동으로 적용 — 페이지 전환 시 server fetch 가
 * 끝날 때까지 메인 컨텐츠 영역을 이 컴포넌트로 채운다. 사이드바·헤더는
 * (features)/layout.tsx 가 유지되므로 그대로 노출.
 *
 * 디자인: 흰색+검정 미니멀, 40~60대 사용자 배려 — 큼직한 스피너(size-7)
 * + 14px 텍스트로 "지금 무언가 동작 중"이라는 신호를 명확히.
 *
 * 페이지별로 더 정밀한 skeleton UI 가 필요하면 해당 페이지 옆에
 * 자체 loading.tsx 를 두면 우선 적용된다 (Next.js segment 단위 fallback).
 */
export default function FeaturesLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center min-h-[60vh] gap-3"
    >
      <Loader2
        className="size-7 animate-spin text-[color:var(--text-muted)]"
        strokeWidth={1.75}
        aria-hidden
      />
      <p className="text-[14px] text-[color:var(--text-muted)]">
        불러오는 중...
      </p>
    </div>
  );
}
