"use client";

import { Users } from "lucide-react";
import type { DedupeCounts } from "@/types/messaging";
import type { PreviewResult } from "@/lib/messaging/preview-recipients";

/**
 * 발송 대상 번호 선택(레그 확장) + 동일번호 1회 발송(dedupe) 인원 표시.
 *
 * backend 가 PreviewResult 에 `dedupe: DedupeCounts` 를 실어 보내면
 * "대상 학생 N명 → 실제 발송 M건" 부가 문구를 렌더한다. 두 경우에 N≠M:
 *   1) 학부모·학생 동시 발송 → 레그 확장으로 학생 1명이 최대 2건 (legs > targetStudents)
 *   2) 동일번호 1회 발송 → 형제 등 합쳐서 발송 (collapsed > 0)
 * 둘 다 걸리면 합산 표기(동시 발송 + 동일번호 합침)한다.
 *
 * 옵셔널 계약: backend 가 아직 dedupe 필드를 안 내려주거나, N=M(레그 확장 없음 +
 * dedupe 미적용/합침 0)이면 부가 문구를 렌더하지 않는다(null). 그 경우 호출부의
 * 기존 단일 인원 표기를 유지한다. legs 필드가 아직 없으면 dedupe 단독 경로로 폴백.
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
 * "대상 학생 N명 → 실제 발송 M건" 분리 표기가 필요한지 판단하는 공용 술어.
 * 호출부(요약 카드·확인 다이얼로그)가 "단일 인원" vs "N→M" 표기를 고를 때 사용.
 *
 * 분리 표기가 필요한 경우(둘 중 하나라도):
 *   - 동일번호 1회 발송으로 합쳐진 건이 있음(collapsed > 0)
 *   - 학부모·학생 동시 발송으로 레그가 학생 수보다 많음(legs > targetStudents)
 *   - 그 외 사유로 실제 발송 건수가 학생 수와 다름(actualMessages ≠ targetStudents)
 */
export function shouldShowLegBreakdown(
  counts: DedupeCounts | null | undefined,
): counts is DedupeCounts {
  if (!counts) return false;
  const collapsed = counts.dedupeApplied ? counts.collapsed : 0;
  const legs = readLegs(counts);
  return (
    collapsed > 0 ||
    legs > counts.targetStudents ||
    counts.actualMessages !== counts.targetStudents
  );
}

/**
 * 레그(legs) 값을 타입 안전하게 읽는다. backend 가 legs 를 아직 안 채웠을 수도
 * 있어(런타임 가드는 legs 를 요구하지 않음) 숫자가 아니면 targetStudents 로 폴백
 * (= 레그 확장 없음 가정). 이렇게 하면 종전 단일 대상 동작과 정확히 일치한다.
 */
function readLegs(counts: DedupeCounts): number {
  const raw = (counts as { legs?: unknown }).legs;
  return typeof raw === "number" && Number.isFinite(raw)
    ? raw
    : counts.targetStudents;
}

/**
 * dedupe 합침이 있거나(레그 합쳐짐) 레그 확장으로 학생 수≠발송 건수일 때만
 * 부가 문구를 렌더. 그 외(N=M)에는 null → 호출부는 종전대로 단일 인원만 표기.
 */
export function DedupeCountNote({ counts, variant = "inline", className }: Props) {
  if (!counts) return null;

  const collapsed = counts.dedupeApplied ? counts.collapsed : 0;
  const legs = readLegs(counts);
  // 레그 확장(동시 발송)으로 학생 수보다 레그가 많은지.
  const legExpanded = legs > counts.targetStudents;

  // N = targetStudents(학생 수), M = actualMessages(실제 발송 건수).
  // 둘이 같고 합쳐진 것도 없으면 굳이 부가 문구 불필요.
  const nNeqM = counts.actualMessages !== counts.targetStudents;
  if (collapsed <= 0 && !legExpanded && !nNeqM) {
    return null;
  }

  // 괄호 안 부연: 동시 발송(레그 확장)·동일번호 합침을 상황에 맞게 합산 표기.
  const notes: string[] = [];
  if (legExpanded) {
    notes.push("학부모·학생 동시 발송");
  }
  if (collapsed > 0) {
    notes.push(`동일번호 ${collapsed.toLocaleString("ko-KR")}건 합침`);
  }

  const text = (
    <>
      대상 학생 {counts.targetStudents.toLocaleString("ko-KR")}명 → 실제 발송{" "}
      <strong className="font-semibold text-[color:var(--text)]">
        {counts.actualMessages.toLocaleString("ko-KR")}건
      </strong>
      {notes.length > 0 && (
        <span className="text-[color:var(--text-muted)]">
          {" "}
          ({notes.join(" · ")})
        </span>
      )}
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
