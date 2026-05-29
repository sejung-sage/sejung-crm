"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { useToast } from "@/components/ui/toast";

/**
 * 공개 신청 링크 복사 버튼.
 *
 * `path` 는 `/s/{token}` 같은 상대 경로. 클릭 시 location.origin 과 합쳐
 * 절대 URL 로 클립보드에 복사.
 *
 * variant:
 *  - "primary"  : 검정 CTA (헤더 액션용)
 *  - "secondary": 카드 안 인라인 (회색 톤)
 *  - "icon"     : 아이콘만 (input 우측)
 */
interface Props {
  path: string;
  variant?: "primary" | "secondary" | "icon";
  label?: string;
}

export function CopyLinkButton({
  path,
  variant = "primary",
  label = "발송 링크 복사",
}: Props) {
  const { show: showToast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    const url = `${origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      showToast("success", "공개 신청 링크를 복사했어요");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("error", "클립보드 복사에 실패했습니다");
    }
  };

  const Icon = copied ? Check : Copy;

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={handleCopy}
        aria-label={label}
        title={label}
        className="
          inline-flex items-center justify-center
          size-10 rounded-lg shrink-0
          border border-[color:var(--border)] bg-bg-card
          text-[color:var(--text-muted)]
          hover:bg-[color:var(--bg-hover)] hover:text-[color:var(--text)]
          transition-colors
        "
      >
        <Icon className="size-4" strokeWidth={1.75} aria-hidden />
      </button>
    );
  }

  if (variant === "secondary") {
    return (
      <button
        type="button"
        onClick={handleCopy}
        className="
          inline-flex items-center gap-1.5 h-9 px-3 rounded-lg
          border border-[color:var(--border)] bg-bg-card
          text-[14px] text-[color:var(--text)]
          hover:bg-[color:var(--bg-hover)]
          transition-colors
        "
      >
        <Icon className="size-4" strokeWidth={1.75} aria-hidden />
        {copied ? "복사됨" : label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="
        inline-flex items-center gap-1.5 h-10 px-4 rounded-lg
        bg-[color:var(--action)] text-[color:var(--action-text)]
        text-[14px] font-medium
        hover:bg-[color:var(--action-hover)]
        transition-colors
      "
    >
      <Icon className="size-4" strokeWidth={1.75} aria-hidden />
      {copied ? "복사됨" : label}
    </button>
  );
}
