"use client";

import Link from "next/link";
import { Plus, Users } from "lucide-react";
import type { GroupListItem } from "@/types/database";
import { BranchBadge } from "@/components/groups/branch-badge";

/**
 * F5 · 설명회 발송 Step 2 — 대상 학생 그룹 선택.
 *
 * 일반 compose 와 마찬가지로 저장된 발송 그룹 1개를 선택.
 * 학생 id 펼침(resolve)은 발송 시점에 backend 가 수행 — 그룹의 필터는
 * 발송 순간의 학생 명단으로 동적 평가된다.
 *
 * (Phase 1+: 학생 직접 선택 / 멀티 그룹 / 학년·과목 즉석 빌더는 별도.)
 */
interface Props {
  groups: GroupListItem[];
  groupId: string;
  onGroupIdChange: (id: string) => void;
}

export function SeminarComposeStep2Group({
  groups,
  groupId,
  onGroupIdChange,
}: Props) {
  const selected = groups.find((g) => g.id === groupId) ?? null;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[16px] font-semibold text-[color:var(--text)]">
          대상 학생 그룹 선택
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
            htmlFor="seminar-compose-group"
            className="text-[14px] font-medium text-[color:var(--text)]"
          >
            발송 그룹
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              id="seminar-compose-group"
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
