"use client";

import { useEffect, useState } from "react";
import { CopyLinkButton } from "./copy-link-button";

/**
 * 메타 카드용 — 공개 URL 을 읽기전용 input 으로 보여주고 우측에 copy 버튼.
 * SSR 시점에는 origin 을 모르므로 클라이언트에서 마운트 후 location.origin 으로 보정.
 */
export function PublicLinkInput({ path }: { path: string }) {
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const displayUrl = origin ? `${origin}${path}` : path;

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={displayUrl}
        readOnly
        aria-label="공개 신청 링크"
        className="
          flex-1 h-10 px-3 rounded-lg
          bg-[color:var(--bg-muted)]
          border border-[color:var(--border)]
          text-[13px] text-[color:var(--text-muted)]
          font-mono
          focus:outline-none focus:border-[color:var(--border-strong)]
        "
        onFocus={(e) => e.currentTarget.select()}
      />
      <CopyLinkButton path={path} variant="icon" label="링크 복사" />
    </div>
  );
}
