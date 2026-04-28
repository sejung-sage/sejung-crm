"use client";

import { useState } from "react";
import { Copy, Eye, EyeOff, Check } from "lucide-react";
import { formatPhone, maskPhone } from "@/lib/phone";

interface Props {
  phone: string | null;
}

/**
 * 학부모 연락처 "번호 보기" / "복사" 버튼 컴포넌트.
 * 기본은 마스킹된 번호 표시. 클릭 시 원본 공개. 복사 시 2초간 라벨 변경.
 */
export function PhoneReveal({ phone }: Props) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!phone) {
    return (
      <span
        className="text-[15px] text-[color:var(--text-dim)] tabular-nums"
        aria-label="학부모 연락처 없음"
      >
        —
      </span>
    );
  }

  const display = revealed ? formatPhone(phone) : maskPhone(phone);

  const onToggle = () => setRevealed((v) => !v);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // 클립보드 접근 실패 시 조용히 실패 (HTTPS/권한 미지원)
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span
        className="text-[15px] text-[color:var(--text)] tabular-nums"
        aria-live="polite"
      >
        {display}
      </span>
      <button
        type="button"
        onClick={onToggle}
        aria-label={revealed ? "번호 숨기기" : "번호 보기"}
        aria-pressed={revealed}
        className="
          inline-flex items-center gap-1 h-10 px-3 rounded-lg
          border border-[color:var(--border)] bg-white
          text-[14px] text-[color:var(--text)]
          hover:bg-[color:var(--bg-hover)] hover:border-[color:var(--border-strong)]
          transition-colors
        "
      >
        {revealed ? (
          <EyeOff className="size-4" strokeWidth={1.75} aria-hidden />
        ) : (
          <Eye className="size-4" strokeWidth={1.75} aria-hidden />
        )}
        {revealed ? "숨기기" : "번호 보기"}
      </button>
      <button
        type="button"
        onClick={onCopy}
        disabled={!revealed}
        aria-label="번호 복사"
        className="
          inline-flex items-center gap-1 h-10 px-3 rounded-lg
          border border-[color:var(--border)] bg-white
          text-[14px] text-[color:var(--text)]
          hover:bg-[color:var(--bg-hover)] hover:border-[color:var(--border-strong)]
          disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white
          transition-colors
        "
      >
        {copied ? (
          <Check className="size-4" strokeWidth={1.75} aria-hidden />
        ) : (
          <Copy className="size-4" strokeWidth={1.75} aria-hidden />
        )}
        {copied ? "복사됨" : "복사"}
      </button>
    </div>
  );
}
