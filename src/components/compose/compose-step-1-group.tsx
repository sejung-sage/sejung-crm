"use client";

import Link from "next/link";
import { Plus, Users } from "lucide-react";
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
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              id="compose-group"
              value={groupId}
              onChange={(e) => onGroupIdChange(e.target.value)}
              className="
                flex-1 h-10 rounded-lg px-3
                bg-bg-card border border-[color:var(--border)]
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
            {/* 새 탭으로 그룹 빌더 진입 — 사용자가 이 화면 상태를 잃지 않고
                새 그룹을 만들고 돌아와 셀렉트에서 선택할 수 있도록. */}
            <Link
              href="/groups/new"
              target="_blank"
              rel="noopener"
              aria-label="새 탭에서 그룹 추가하기"
              className="
                inline-flex items-center justify-center gap-1.5
                h-10 px-4 rounded-lg shrink-0
                bg-bg-card border border-[color:var(--border)]
                text-[14px] font-medium text-[color:var(--text)]
                hover:bg-[color:var(--bg-hover)] hover:border-[color:var(--border-strong)]
                transition-colors
              "
            >
              <Plus className="size-4" strokeWidth={2} aria-hidden />
              그룹 추가하기
            </Link>
          </div>
          <p className="text-[12px] text-[color:var(--text-dim)]">
            새 탭에서 그룹을 만든 뒤 돌아와 위에서 선택해 주세요.
          </p>
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
    // grades 는 0012 이후 "고1"/"중2"/"초등" 등 완전한 enum 값이라
    // 추가 "고" prefix 가 붙으면 "고고1" 처럼 중복됨. 그대로 join.
    parts.push(`학년: ${f.grades.join(", ")}`);
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
