import { Filter, ListChecks } from "lucide-react";
import type { GroupFilters, GroupKind } from "@/lib/schemas/group";
import { resolveGroupKind } from "@/lib/schemas/group";

/**
 * 발송 그룹 종류 배지. [필터] / [커스텀] (사용자 확정 2026-05-27).
 *
 * - filter (조건 동기화): 항상 동기화되는 동적 그룹.
 * - custom (고정 명단): 직접 담은 정적 명단.
 *
 * BranchBadge 와 같은 흑백 미니멀 톤(보라/강한색 금지). 색만으로 구분하지 않고
 * 아이콘 + 한글 라벨을 병기 (40~60대 사용자 배려·접근성).
 */
export function GroupKindBadge({
  filters,
}: {
  filters: { kind?: GroupKind };
}) {
  const kind = resolveGroupKind(filters);
  const isCustom = kind === "custom";
  const Icon = isCustom ? ListChecks : Filter;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-medium"
      style={{
        backgroundColor: "var(--bg-muted)",
        color: "var(--text-muted)",
      }}
      title={
        isCustom
          ? "고정 명단 — 만든 시점에 담은 학생만 발송 대상입니다."
          : "필터 그룹 — 조건에 맞는 학생이 자동 포함됩니다 (신규 학생 자동 반영)."
      }
    >
      <Icon className="size-3" strokeWidth={1.75} aria-hidden />
      {isCustom ? "커스텀" : "필터"}
    </span>
  );
}

/** GroupFilters 를 직접 받는 편의 래퍼 (호출부 가독성). */
export function groupKindLabel(filters: GroupFilters): string {
  return resolveGroupKind(filters) === "custom" ? "커스텀" : "필터";
}
