"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

/**
 * 발송 본문 "서식 없이 복사" 버튼.
 *
 * 배경 (2026-08-05, 행정팀 컴플레인):
 *   화면의 본문을 드래그 선택해 Ctrl+C 하면 클립보드에 text/plain 과 text/html
 *   두 형식이 함께 담긴다. 한글(HWP)은 붙여넣기 때 text/html 을 우선하는데,
 *   본문은 <p> 하나에 CSS white-space:pre-wrap 으로 줄바꿈을 표현하고 있어
 *   HWP 의 HTML 해석기가 그 CSS 를 무시하고 개행을 공백으로 뭉갠다.
 *   → HWP 로 붙여넣으면 줄바꿈이 사라지고 한 문단이 된다.
 *
 * navigator.clipboard.writeText 는 text/plain 만 쓰므로 HWP 가 고를 HTML 형식이
 * 애초에 없다. 서식도 함께 사라져 붙여넣는 쪽 문단 서식(글꼴·크기)을 그대로
 * 따라간다 — 10pt/11pt 혼재 문제도 같이 해결된다.
 *
 * 줄바꿈은 CRLF 로 맞춰 넣는다. Blink 가 Windows 에서 한 번 더 정규화하지만
 * 직전 문자가 \r 이면 건너뛰므로 중복 변환되지 않는다.
 */
interface Props {
  body: string;
}

export function CopyBodyButton({ body }: Props) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const onCopy = async () => {
    // 저장 값은 LF 기준이지만 경로에 따라 CRLF 가 섞일 수 있어 한 번 접었다 편다.
    const text = body.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
    try {
      await navigator.clipboard.writeText(text);
      setFailed(false);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // HTTPS 아님·권한 거부 등. 조용히 실패하면 사용자가 붙여넣기 전까지
      // 모르므로 라벨로 알린다.
      setFailed(true);
      window.setTimeout(() => setFailed(false), 2000);
    }
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      title="한글(HWP)·메모장에 붙여넣을 수 있게 서식 없이 본문만 복사합니다"
      className="
        inline-flex items-center gap-1.5 h-10 px-3 rounded-lg
        text-[14px] font-medium
        bg-bg-card text-[color:var(--text)]
        border border-[color:var(--border)]
        hover:bg-[color:var(--bg-hover)] hover:border-[color:var(--border-strong)]
        focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--border-strong)]
        transition-colors
      "
    >
      {copied ? (
        <Check className="size-4" strokeWidth={1.75} aria-hidden />
      ) : (
        <Copy className="size-4" strokeWidth={1.75} aria-hidden />
      )}
      <span aria-live="polite">
        {failed ? "복사 실패" : copied ? "복사됨" : "본문 복사"}
      </span>
    </button>
  );
}
