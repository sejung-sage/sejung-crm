"use client";

import { useState } from "react";
import { Copy, Eye, EyeOff, Check } from "lucide-react";
import { formatPhone, maskPhone } from "@/lib/phone";

interface Props {
  phone: string | null;
  /**
   * 번호 보기 토글 허용 여부. false 면 마스킹된 번호만 보이고
   * 토글·복사 버튼이 사라진다. master 만 true.
   */
  canReveal?: boolean;
}

/**
 * 학부모 연락처 "번호 보기" / "복사" 버튼 컴포넌트.
 * 기본은 마스킹된 번호 표시. 클릭 시 원본 공개. 복사 시 2초간 라벨 변경.
 * canReveal=false 면 버튼 자체가 사라지고 마스킹된 표시만 남는다.
 */
export function PhoneReveal({ phone, canReveal = false }: Props) {
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

  const display = canReveal && revealed ? formatPhone(phone) : maskPhone(phone);

  const onToggle = () => setRevealed((v) => !v);

  if (!canReveal) {
    return (
      <span
        className="text-[15px] text-[color:var(--text)] tabular-nums"
        aria-label="학부모 연락처 (마스킹됨)"
      >
        {display}
      </span>
    );
  }

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
          border border-[color:var(--border)] bg-bg-card
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
          border border-[color:var(--border)] bg-bg-card
          text-[14px] text-[color:var(--text)]
          hover:bg-[color:var(--bg-hover)] hover:border-[color:var(--border-strong)]
          disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-bg-card
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
