"use client";

import { Users } from "lucide-react";
import type { DedupeCounts } from "@/types/messaging";
import type { PreviewResult } from "@/lib/messaging/preview-recipients";

/**
 * 동일번호 1회 발송(중복 번호 dedupe) 인원 표시.
 *
 * backend 가 PreviewResult 에 `dedupe: DedupeCounts` 를 실어 보내면
 * "대상 학생 N명 → 실제 발송 M건(동일번호 K건 합침)" 부가 문구를 렌더한다.
 *
 * 옵셔널 계약: backend 가 아직 dedupe 필드를 안 내려주거나, dedupe 가
 * 적용되지 않았거나(=dedupeApplied=false), 합쳐진 중복이 없으면(collapsed=0)
 * 부가 문구를 렌더하지 않는다(null). 그 경우 호출부의 기존 단일 인원 표기를 유지.
 *
 * 비용은 frontend 에서 재계산하지 않는다 — backend 가 actualMessages 기준으로
 * 내려주는 값을 그대로 쓴다(여긴 인원만 표시).
 */

/**
 * PreviewResult 에서 옵셔널 dedupe 필드를 타입 안전하게 추출.
 * backend 가 PreviewResult 에 dedupe 를 추가하기 "전"에도 컴파일·동작하도록
 * 구조적 접근 + 런타임 가드로 읽는다(any 미사용).
 */
export function extractDedupeCounts(
  preview: PreviewResult | null,
): DedupeCounts | null {
  if (!preview) return null;
  const candidate = (preview as { dedupe?: unknown }).dedupe;
  if (!isDedupeCounts(candidate)) return null;
  return candidate;
}

function isDedupeCounts(v: unknown): v is DedupeCounts {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.dedupeApplied === "boolean" &&
    typeof o.targetStudents === "number" &&
    typeof o.actualMessages === "number" &&
    typeof o.collapsed === "number"
  );
}

interface Props {
  /** backend 가 내려준 dedupe 카운트. null/미적용이면 렌더 안 함. */
  counts: DedupeCounts | null;
  /** 표시 형태. "inline": 한 줄 회색 문구 / "card": 박스 강조. */
  variant?: "inline" | "card";
  className?: string;
}

/**
 * dedupe 가 실제로 적용되고 1건 이상 합쳐졌을 때만 부가 문구를 렌더.
 * 그 외에는 null → 호출부는 종전대로 단일 인원만 표기한다.
 */
export function DedupeCountNote({ counts, variant = "inline", className }: Props) {
  if (!counts || !counts.dedupeApplied || counts.collapsed <= 0) {
    return null;
  }

  const text = (
    <>
      대상 학생 {counts.targetStudents.toLocaleString("ko-KR")}명 → 실제 발송{" "}
      <strong className="font-semibold text-[color:var(--text)]">
        {counts.actualMessages.toLocaleString("ko-KR")}건
      </strong>
      <span className="text-[color:var(--text-muted)]">
        {" "}
        (동일번호 {counts.collapsed.toLocaleString("ko-KR")}건 합침)
      </span>
    </>
  );

  if (variant === "card") {
    return (
      <div
        role="note"
        className={`flex items-start gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-4 py-3 ${
          className ?? ""
        }`}
      >
        <Users
          className="size-4 mt-0.5 text-[color:var(--text-muted)] shrink-0"
          strokeWidth={1.75}
          aria-hidden
        />
        <p className="text-[13px] leading-relaxed text-[color:var(--text-muted)] tabular-nums">
          {text}
        </p>
      </div>
    );
  }

  return (
    <p
      className={`flex items-center gap-1.5 text-[12px] leading-relaxed text-[color:var(--text-muted)] tabular-nums ${
        className ?? ""
      }`}
    >
      <Users className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
      {text}
    </p>
  );
}
