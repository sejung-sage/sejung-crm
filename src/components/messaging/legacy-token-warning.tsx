"use client";

import { AlertTriangle } from "lucide-react";
import {
  findLegacyTokens,
  hasConvertibleLegacyToken,
  convertLegacyTokens,
} from "@/lib/messaging/legacy-tokens";

interface Props {
  /** 검사할 본문. */
  body: string;
  /** "자동으로 고치기" 클릭 시 변환된 본문을 돌려준다. */
  onConvert: (next: string) => void;
}

/**
 * Aca2000 문법(`%%학생`) 경고 배너.
 *
 * 행정팀이 Aca2000 문구를 그대로 붙여넣는 일이 잦아, 저장·발송 전에
 * "이 글자는 이름으로 바뀌지 않는다" 를 알리고 한 번에 고치게 한다.
 * 토큰이 없으면 아무것도 렌더하지 않는다.
 */
export function LegacyTokenWarning({ body, onConvert }: Props) {
  const tokens = findLegacyTokens(body);
  if (tokens.length === 0) return null;

  const fixable = hasConvertibleLegacyToken(body);

  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-[color:var(--warning)] bg-[color:var(--warning-bg)] px-3 py-2.5"
    >
      <AlertTriangle
        className="size-4 mt-0.5 shrink-0 text-[color:var(--warning)]"
        strokeWidth={1.75}
        aria-hidden
      />
      <div className="flex-1 space-y-1.5">
        <p className="text-[13px] leading-relaxed text-[color:var(--text)]">
          본문에 <strong>{tokens.join(", ")}</strong> 이(가) 있습니다. 이건
          Aca2000 문법이라 <strong>글자 그대로 발송됩니다.</strong> 학생 이름이
          들어가려면 <strong>{"{이름}"}</strong> 을 써야 합니다.
        </p>
        {fixable && (
          <button
            type="button"
            onClick={() => onConvert(convertLegacyTokens(body))}
            className="inline-flex items-center h-9 px-3 rounded-lg border border-[color:var(--warning)] bg-bg-card text-[13px] font-medium text-[color:var(--text)] hover:bg-[color:var(--bg-hover)] focus:outline-none focus:ring-2 focus:ring-[color:var(--border-strong)] transition-colors"
          >
            {"%%학생 → {이름} 으로 자동 변경"}
          </button>
        )}
      </div>
    </div>
  );
}
