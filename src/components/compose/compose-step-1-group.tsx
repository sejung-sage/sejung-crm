"use client";

import Link from "next/link";
import { Users } from "lucide-react";
import type { GroupListItem } from "@/types/database";
import { BranchBadge } from "@/components/groups/branch-badge";

/**
 * F3 Part B · Step 1 — 발송할 그룹 선택.
 *
 * - 그룹 드롭다운 (분원 · 그룹명).
 * - 선택 시 그룹 요약 카드 (분원/필터/수신자 수) 표시.
 * - 그룹 목록이 비어 있으면 안내 + /groups/new 링크.
 */
interface Props {
  groups: GroupListItem[];
  groupId: string;
  onGroupIdChange: (id: string) => void;
}

export function ComposeStep1Group({ groups, groupId, onGroupIdChange }: Props) {
  const selected = groups.find((g) => g.id === groupId) ?? null;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
          발송할 그룹 선택
        </h2>
        <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">
          저장해 둔 발송 그룹 중 하나를 골라주세요. 발송 시점에 학생 명단이
          자동 재조회됩니다.
        </p>
      </div>

      {groups.length === 0 ? (
        <div
          role="alert"
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] px-4 py-3 text-[14px] text-[color:var(--text-muted)]"
        >
          저장된 발송 그룹이 없습니다.{" "}
          <Link
            href="/groups/new"
            className="underline text-[color:var(--text)] hover:text-[color:var(--action)]"
          >
            새 그룹 만들기
          </Link>
        </div>
      ) : (
        <div className="space-y-1.5">
          <label
            htmlFor="compose-group"
            className="text-[14px] font-medium text-[color:var(--text)]"
          >
            발송 그룹
          </label>
          <select
            id="compose-group"
            value={groupId}
            onChange={(e) => onGroupIdChange(e.target.value)}
            className="
              w-full h-10 rounded-lg px-3
              bg-white border border-[color:var(--border)]
              text-[15px] text-[color:var(--text)]
              focus:outline-none focus:border-[color:var(--border-strong)]
              cursor-pointer
            "
          >
            <option value="">— 그룹을 선택하세요 —</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                [{g.branch}] {g.name} · {g.recipient_count.toLocaleString()}명
              </option>
            ))}
          </select>
        </div>
      )}

      {selected && (
        <section
          aria-label="선택된 그룹 요약"
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg-muted)] p-4 space-y-3"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[15px] font-semibold text-[color:var(--text)]">
              {selected.name}
            </span>
            <BranchBadge branch={selected.branch} />
          </div>

          <div className="text-[13px] text-[color:var(--text-muted)]">
            {summarizeFilters(selected)}
          </div>

          <div className="flex items-center gap-2 text-[14px] text-[color:var(--text)]">
            <Users
              className="size-4 text-[color:var(--text-muted)]"
              strokeWidth={1.75}
              aria-hidden
            />
            <span className="tabular-nums font-medium">
              총 {selected.recipient_count.toLocaleString()}명
            </span>
            <span className="text-[12px] text-[color:var(--text-muted)]">
              (탈퇴/수신거부는 발송 시점에 자동 제외)
            </span>
          </div>
        </section>
      )}
    </div>
  );
}

// ─── 내부: 필터 요약 문자열 ───────────────────────────────────

function summarizeFilters(group: GroupListItem): string {
  const parts: string[] = [];
  const f = group.filters;
  if (f.grades.length > 0) {
    parts.push(`학년: ${f.grades.map((g) => `고${g}`).join(", ")}`);
  } else {
    parts.push("학년: 전체");
  }
  if (f.schools.length > 0) {
    parts.push(
      `학교: ${f.schools.length <= 2 ? f.schools.join(", ") : `${f.schools[0]} 외 ${f.schools.length - 1}곳`}`,
    );
  } else {
    parts.push("학교: 전체");
  }
  if (f.subjects.length > 0) {
    parts.push(`과목: ${f.subjects.join(", ")}`);
  } else {
    parts.push("과목: 전체");
  }
  return parts.join(" · ");
}
